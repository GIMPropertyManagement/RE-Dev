import { RESEARCH_TTL_DAYS, type ResearchKind } from '@forge/shared';

/** Kinds whose result depends on the listing's price/status (not just the parcel). */
const PRICE_SENSITIVE: ReadonlySet<ResearchKind> = new Set<ResearchKind>(['cma', 'feasibility']);

export interface CachedMeta {
  generatedAt: string;
  staleAfter: string | null;
}

/**
 * Caching rule (PRD §5): use the cached record if it isn't past its TTL AND the
 * listing hasn't materially changed (price/status). Material change only busts
 * price-sensitive kinds (CMA/feasibility) — a price cut doesn't change zoning.
 */
export function shouldRegenerate(
  kind: ResearchKind,
  existing: CachedMeta | null,
  opts: { materialChange?: boolean; now?: number } = {},
): boolean {
  if (!existing) return true;
  const now = opts.now ?? Date.now();

  if (existing.staleAfter != null && now >= Date.parse(existing.staleAfter)) return true;
  // TTL of 0 (feasibility) means "no clock" — recompute on input/comp change only.
  if (RESEARCH_TTL_DAYS[kind] === 0 && opts.materialChange) return true;
  if (opts.materialChange && PRICE_SENSITIVE.has(kind)) return true;

  return false;
}

/** When to next consider this kind stale. null = no clock (recompute on change). */
export function computeStaleAfter(kind: ResearchKind, generatedAt: number = Date.now()): string | null {
  const days = RESEARCH_TTL_DAYS[kind];
  if (!days) return null;
  return new Date(generatedAt + days * 24 * 3600 * 1000).toISOString();
}
