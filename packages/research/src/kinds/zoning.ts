import type { Confidence, NeedsHumanReason, SourceRef } from '@forge/shared';
import { MODELS, NEVER_INVENT_SYSTEM } from '../claude.js';
import { ZONING_SCHEMA, type ZoningPayload } from '../schemas.js';
import type { ResearchProducer } from '../types.js';
import { validateSources } from '../urlValidator.js';
import { unresolvedResult } from './util.js';

const EMPTY: ZoningPayload = {
  district: null,
  min_lot_sqft: null,
  min_frontage_ft: null,
  setbacks: null,
  max_coverage_pct: null,
  max_height_ft: null,
  allowed_uses: [],
  adu_allowed: null,
  lot_of_record_protection: null,
  variance_needed: [],
  notes: null,
};

/** What the model returns: the payload fields + the meta envelope fields. */
type ZoningReturn = ZoningPayload & {
  sources: SourceRef[];
  confidence: Confidence;
  needs_human: boolean;
  needs_human_reasons: NeedsHumanReason[];
};

/**
 * The one LLM kind: read the town's adopted zoning bylaw and extract dimensional
 * standards + variance flags. Highest-variance kind (per-town PDFs, no statewide
 * source), so source URLs are validated against the gov/ordinance allowlist and a
 * result with no surviving sources is downgraded to needs_human.
 */
export const zoningKind: ResearchProducer<ZoningPayload> = async (input, deps) => {
  if (!deps.llm) return unresolvedResult('zoning', EMPTY, 'data_unavailable');
  if (!input.town && !input.address) return unresolvedResult('zoning', EMPTY);

  const userPrompt = [
    `Massachusetts parcel: ${input.address ?? '(address unknown)'} in ${input.town ?? '(town unknown)'}.`,
    input.lotAcres != null ? `Lot size ≈ ${input.lotAcres} acres.` : '',
    input.zoningHint ? `MLS zoning hint (verify, do not trust): ${input.zoningHint}.` : '',
    '',
    "Find the town's CURRENT adopted zoning bylaw (the municipal site or an authoritative code publisher).",
    "Identify this parcel's zoning district and extract the dimensional standards: min lot size (sqft), min frontage (ft), front/side/rear setbacks, max lot coverage (%), max building height (ft), and the allowed residential uses (single-family / 2-family / 3-family / condo).",
    'Determine adu_allowed (MA ADUs are by-right in single-family districts statewide since Feb 2 2025) and lot_of_record_protection (MA c.40A §6).',
    'In variance_needed, list any standard this parcel likely fails (e.g. frontage shortfall vs the district minimum).',
    'Cite the exact bylaw section URL for every figure. If you cannot verify a figure from the ordinance, set it null and flag needs_human.',
  ]
    .filter(Boolean)
    .join('\n');

  const { data, seenUrls } = await deps.llm.research<ZoningReturn>({
    system: `${NEVER_INVENT_SYSTEM}\n\nYou are extracting ZONING for a build-feasibility analysis.`,
    userPrompt,
    schema: ZONING_SCHEMA,
    model: MODELS.synthesis, // zoning drives variance risk -> strongest model
  });

  // Validate the model's cited URLs against the gov/ordinance allowlist + "fetched this turn".
  const { valid, dropped } = await validateSources(data.sources ?? [], {
    seenUrls,
    fetchImpl: deps.fetchImpl,
  });

  const reasons = new Set<NeedsHumanReason>(data.needs_human_reasons ?? []);
  if (dropped.length) reasons.add('url_unverifiable');
  if (valid.length === 0) reasons.add('no_source_found');

  const needsHuman = data.needs_human || valid.length === 0;
  const confidence: Confidence = valid.length === 0 ? 'low' : data.confidence ?? 'low';

  const { sources: _s, confidence: _c, needs_human: _nh, needs_human_reasons: _nhr, ...payload } =
    data;

  return {
    kind: 'zoning',
    payload,
    sources: valid,
    confidence,
    needsHuman,
    needsHumanReasons: [...reasons],
  };
};
