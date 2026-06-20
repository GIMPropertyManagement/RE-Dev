import type { NeedsHumanReason, ResearchKind } from '@forge/shared';
import type { ResearchResult } from '../types.js';

/** A result for a parcel that lacks the geometry/identity a kind needs. */
export function unresolvedResult<T>(
  kind: ResearchKind,
  emptyPayload: T,
  reason: NeedsHumanReason = 'parcel_unresolved',
): ResearchResult<T> {
  return {
    kind,
    payload: emptyPayload,
    sources: [],
    confidence: 'low',
    needsHuman: true,
    needsHumanReasons: [reason],
  };
}

export function median(nums: number[]): number | null {
  const xs = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

export function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
