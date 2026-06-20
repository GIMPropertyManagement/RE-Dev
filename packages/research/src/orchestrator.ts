import type { ResearchKind } from '@forge/shared';
import { Db, getResearch, upsertResearch } from '@forge/db';
import { computeStaleAfter, shouldRegenerate } from './cache.js';
import { floodKind } from './kinds/flood.js';
import { wetlandsKind } from './kinds/wetlands.js';
import { topoKind } from './kinds/topo.js';
import { ownershipKind } from './kinds/ownership.js';
import { cmaKind } from './kinds/cma.js';
import { zoningKind } from './kinds/zoning.js';
import type { ProducerDeps, ResearchInput, ResearchProducer, ResearchResult } from './types.js';

/** The producer registry. Feasibility (Phase 3 synthesis) is added later. */
export const PRODUCERS: Record<Exclude<ResearchKind, 'feasibility'>, ResearchProducer> = {
  flood: floodKind,
  wetlands: wetlandsKind,
  topo: topoKind,
  ownership: ownershipKind,
  cma: cmaKind,
  zoning: zoningKind,
};

export const DEFAULT_KINDS = Object.keys(PRODUCERS) as Exclude<ResearchKind, 'feasibility'>[];

export interface OrchestrateOpts {
  kinds?: Exclude<ResearchKind, 'feasibility'>[];
  /** Listing changed price/status since last run — busts price-sensitive caches. */
  materialChange?: boolean;
  /** Force a full re-research (the /reresearch endpoint). */
  force?: boolean;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

/**
 * Run the research engine for one parcel, honoring the per-kind cache. Each kind
 * is checked against research_cache; only stale / changed / forced kinds are
 * (re)produced and written back. This is the "never re-research" core.
 */
export async function runParcelResearch(
  db: Db,
  input: ResearchInput,
  deps: ProducerDeps,
  opts: OrchestrateOpts = {},
): Promise<Record<string, ResearchResult>> {
  const kinds = opts.kinds ?? DEFAULT_KINDS;
  const log = opts.log ?? (() => {});
  const out: Record<string, ResearchResult> = {};

  for (const kind of kinds) {
    const existing = await getResearch(db, input.parcelId, kind);
    const meta = existing
      ? { generatedAt: existing.generated_at, staleAfter: existing.stale_after }
      : null;
    const regenerate =
      opts.force || shouldRegenerate(kind, meta, { materialChange: opts.materialChange });

    if (!regenerate && existing) {
      out[kind] = {
        kind,
        payload: existing.payload,
        sources: (existing.sources as ResearchResult['sources']) ?? [],
        confidence: existing.confidence as ResearchResult['confidence'],
        needsHuman: existing.needs_human,
        needsHumanReasons: existing.needs_human_reasons as ResearchResult['needsHumanReasons'],
      };
      continue;
    }

    try {
      const result = await PRODUCERS[kind](input, deps);
      await upsertResearch(db, input.parcelId, {
        kind: result.kind,
        payload: result.payload,
        sources: result.sources,
        confidence: result.confidence,
        needsHuman: result.needsHuman,
        needsHumanReasons: result.needsHumanReasons,
        staleAfter: computeStaleAfter(kind),
      });
      out[kind] = result;
      log('research_kind_done', { parcelId: input.parcelId, kind, confidence: result.confidence });
    } catch (err) {
      log('research_kind_failed', {
        parcelId: input.parcelId,
        kind,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return out;
}
