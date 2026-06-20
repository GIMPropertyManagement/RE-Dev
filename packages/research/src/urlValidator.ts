import type { SourceRef } from '@forge/shared';
import type { FetchLike } from './types.js';

/**
 * The backstop against fabricated citations.
 *
 * Because the Citations API is incompatible with structured outputs, source URLs
 * are free-text model output and can be hallucinated. Every URL the model emits
 * is validated here against three gates:
 *   1. host allowlist — must be a government source or a recognized ordinance
 *      publisher (where MA town zoning bylaws actually live);
 *   2. "seen this turn" — if we captured the URLs the model actually fetched via
 *      web_fetch this turn, the cited URL must be among them (no inventing links);
 *   3. reachability (optional) — a HEAD/GET that doesn't 5xx/404.
 * Anything that fails is dropped and recorded; if validation removes all sources
 * for a grounded figure, the caller downgrades the result to needs_human.
 */

/** Allowed host suffixes. Gov + the third-party code publishers towns use. */
const ALLOWED_SUFFIXES = [
  '.gov', // fema.gov, hazards.fema.gov, town .gov sites, mass.gov, digital.mass.gov
  '.ma.us', // town.<x>.ma.us municipal sites
  '.census.gov',
  '.usgs.gov',
  '.epa.gov',
  // Ordinance / municipal code publishers (authoritative copies of town bylaws):
  'ecode360.com',
  'municode.com',
  'generalcode.com',
  'amlegal.com',
  'masslandrecords.com',
  // Assessor portals (fallback only):
  'vgsi.com',
  'patriotproperties.com',
];

export type DropReason = 'bad_url' | 'host_not_allowed' | 'not_fetched_this_turn' | 'unreachable';

export interface SourceValidation {
  valid: SourceRef[];
  dropped: { source: SourceRef; reason: DropReason }[];
}

export interface ValidateOpts {
  /** URLs actually fetched via web_fetch this turn. When provided, gate 2 applies. */
  seenUrls?: Set<string>;
  /** When true, do a network reachability check (gate 3). Off by default/tests. */
  checkReachable?: boolean;
  fetchImpl?: FetchLike;
}

export function isAllowedHost(host: string): boolean {
  const h = host.toLowerCase();
  return ALLOWED_SUFFIXES.some((s) => h === s.replace(/^\./, '') || h.endsWith(s));
}

export async function validateSources(
  sources: SourceRef[],
  opts: ValidateOpts = {},
): Promise<SourceValidation> {
  const valid: SourceRef[] = [];
  const dropped: SourceValidation['dropped'] = [];

  for (const src of sources) {
    let url: URL;
    try {
      url = new URL(src.url);
    } catch {
      dropped.push({ source: src, reason: 'bad_url' });
      continue;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      dropped.push({ source: src, reason: 'bad_url' });
      continue;
    }
    if (!isAllowedHost(url.hostname)) {
      dropped.push({ source: src, reason: 'host_not_allowed' });
      continue;
    }
    if (opts.seenUrls && !opts.seenUrls.has(src.url) && !opts.seenUrls.has(url.toString())) {
      dropped.push({ source: src, reason: 'not_fetched_this_turn' });
      continue;
    }
    if (opts.checkReachable && !(await isReachable(src.url, opts.fetchImpl))) {
      dropped.push({ source: src, reason: 'unreachable' });
      continue;
    }
    valid.push(src);
  }

  return { valid, dropped };
}

async function isReachable(url: string, fetchImpl: FetchLike = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(url, { method: 'HEAD' });
    if (res.status < 400) return true;
    // Some gov servers reject HEAD — retry GET.
    const get = await fetchImpl(url, { method: 'GET' });
    return get.status < 400;
  } catch {
    return false;
  }
}
