import Anthropic from '@anthropic-ai/sdk';

/**
 * Claude wrapper for the LLM research kinds (zoning, CMA) and feasibility
 * synthesis.
 *
 * Encodes the verified Claude-API facts:
 *  - structured output via output_config.format (json_schema) — NOT the Citations
 *    API (incompatible). sources[] are schema fields; we validate them in
 *    urlValidator.ts.
 *  - server-side web_search_20260209 / web_fetch_20260209 (headless; no browser).
 *  - adaptive thinking only (claude-opus-4-8); pause_turn continuation loop run
 *    inside one call by re-sending response.content (never a synthetic "Continue").
 *  - model routing: claude-haiku-4-5 for cheap extraction, claude-opus-4-8 for
 *    the money-driving synthesis.
 *
 * NOTE: these params (output_config, the _20260209 tools, adaptive thinking,
 * claude-opus-4-8) are newer than the installed SDK's static types, so the
 * request body is built as a plain object and passed through. The wire shape is
 * correct; only the TS typings lag.
 */

export const MODELS = {
  extraction: 'claude-haiku-4-5',
  synthesis: 'claude-opus-4-8',
} as const;

export const NEVER_INVENT_SYSTEM = `You are a Massachusetts land-use and real-estate analyst producing data that drives real purchase decisions. Rules:
- Use the web_search and web_fetch tools to find PRIMARY / government sources (the municipality's adopted zoning bylaw, assessor records, MLS sold data).
- Return ONLY JSON matching the provided schema.
- Cite every figure with a source URL that you actually fetched this turn. Never cite a URL you did not retrieve.
- If a value cannot be verified from a primary source, set it to null and add the appropriate code to needs_human_reasons (and set needs_human=true). NEVER estimate, guess, or carry a figure from prior knowledge.
- Do not infer dimensional zoning requirements; read them from the ordinance text.`;

export interface ResearchLlmConfig {
  apiKey: string;
  /** Per-call max output tokens (streamed). Default 8000 extraction / 16000 synthesis. */
  maxTokens?: number;
  maxContinuations?: number;
}

export interface ResearchCall {
  system: string;
  userPrompt: string;
  schema: object;
  model?: string;
  maxTokens?: number;
}

export interface ResearchCallResult<T> {
  data: T;
  /** URLs the model actually fetched/saw this turn (for source validation). */
  seenUrls: Set<string>;
  stopReason: string | null;
}

interface LooseBlock {
  type: string;
  text?: string;
  [k: string]: unknown;
}
interface LooseResponse {
  content: LooseBlock[];
  stop_reason: string | null;
}

export class ResearchLlm {
  private readonly client: Anthropic;

  constructor(private readonly cfg: ResearchLlmConfig) {
    this.client = new Anthropic({ apiKey: cfg.apiKey });
  }

  async research<T>(call: ResearchCall): Promise<ResearchCallResult<T>> {
    const model = call.model ?? MODELS.synthesis;
    const maxTokens = call.maxTokens ?? this.cfg.maxTokens ?? 16000;
    const maxContinuations = this.cfg.maxContinuations ?? 5;

    const messages: { role: 'user' | 'assistant'; content: unknown }[] = [
      { role: 'user', content: call.userPrompt },
    ];

    const body = {
      model,
      max_tokens: maxTokens,
      system: call.system,
      thinking: { type: 'adaptive' as const },
      tools: [
        { type: 'web_search_20260209', name: 'web_search' },
        { type: 'web_fetch_20260209', name: 'web_fetch' },
      ],
      output_config: { format: { type: 'json_schema', schema: call.schema } },
      messages,
    };

    const seenUrls = new Set<string>();
    let response: LooseResponse | null = null;

    for (let i = 0; i <= maxContinuations; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      response = (await (this.client.messages.create as any)({ ...body, messages })) as LooseResponse;
      collectUrls(response.content, seenUrls);

      if (response.stop_reason !== 'pause_turn') break;
      // Resume: re-send the assistant turn so the server continues its tool loop.
      messages.push({ role: 'assistant', content: response.content });
    }

    if (!response) throw new Error('No response from Claude');
    if (response.stop_reason === 'refusal') {
      throw new ResearchRefusalError();
    }
    const data = parseStructured<T>(response.content);
    return { data, seenUrls, stopReason: response.stop_reason };
  }
}

export class ResearchRefusalError extends Error {
  constructor() {
    super('Claude refused the research request');
    this.name = 'ResearchRefusalError';
  }
}

/** The structured output lands in the final text block as JSON. */
function parseStructured<T>(content: LooseBlock[]): T {
  const text = content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('');
  if (!text.trim()) throw new Error('Empty structured output (possible max_tokens truncation)');
  return JSON.parse(text) as T;
}

/** Recursively collect any `url` string fields from tool-use / result blocks. */
function collectUrls(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const n of node) collectUrls(n, out);
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'url' && typeof v === 'string') out.add(v);
      else collectUrls(v, out);
    }
  }
}

export { collectUrls as _collectUrls };
