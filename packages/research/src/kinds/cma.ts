import type { MlsListing } from '@forge/shared';
import type { CmaComp, CmaPayload } from '../schemas.js';
import type { ResearchProducer } from '../types.js';
import { median, round, unresolvedResult } from './util.js';

const EMPTY: CmaPayload = {
  recommended_product: null,
  target_sqft: null,
  comps: [],
  ppsf_low: null,
  ppsf_median: null,
  ppsf_high: null,
  arv_low: null,
  arv_high: null,
  avm_cross_check: null,
  notes: null,
};

const TARGET_SQFT = 3200; // midpoint of the 3,000–3,400 SF default product

/**
 * Deterministic CMA from OUR OWN provider sold comps — no LLM, so no fabricated
 * comps. Computes $/SF distribution and an ARV for the default product, with the
 * provider AVM as a cross-check (flagged, never authoritative). Thin comp depth
 * downgrades confidence and flags needs_human.
 */
export const cmaKind: ResearchProducer<CmaPayload> = async (input, deps) => {
  if (input.lat == null || input.lng == null || !deps.comps) {
    return unresolvedResult('cma', EMPTY, 'data_unavailable');
  }

  const sold = await deps.comps.fetchSoldComps({
    lat: input.lat,
    lng: input.lng,
    radiusMi: 1,
    soldSinceMonths: 12,
    minSqft: 1000,
  });

  const comps: CmaComp[] = sold
    .filter((c) => c.closePrice && c.livingArea)
    .map((c) => ({
      address: c.unparsedAddress ?? null,
      sold_price: c.closePrice ?? null,
      sqft: c.livingArea ?? null,
      ppsf: round((c.closePrice as number) / (c.livingArea as number), 2),
      sold_date: c.closeDate ?? null,
      distance_mi: distanceMi(input.lat!, input.lng!, c),
      source_url: c.listingKey ? `mls:${c.listingKey}` : null,
    }));

  const ppsfs = comps.map((c) => c.ppsf).filter((p): p is number => p != null);
  const ppsfMedian = median(ppsfs);
  const ppsfLow = ppsfs.length ? Math.min(...ppsfs) : null;
  const ppsfHigh = ppsfs.length ? Math.max(...ppsfs) : null;

  const arv = ppsfMedian != null ? Math.round(ppsfMedian * TARGET_SQFT) : null;
  const arvLow = ppsfLow != null ? Math.round(ppsfLow * TARGET_SQFT) : null;
  const arvHigh = ppsfHigh != null ? Math.round(ppsfHigh * TARGET_SQFT) : null;

  // AVM cross-check of the PLANNED build's ARV (does not override comp-derived
  // ARV; flags divergence). /estimates values a built home, so we pass the
  // planned product's specs. Best-effort: a failed estimate must never sink the
  // CMA, so it's wrapped and skipped on error.
  let avm: CmaPayload['avm_cross_check'] = null;
  if (deps.comps.fetchEstimate) {
    try {
      const est = await deps.comps.fetchEstimate({
        address: { city: input.town ?? undefined },
        details: { numBedrooms: 4, numBathrooms: 3, propertyType: 'Detached', sqft: TARGET_SQFT, style: 'Detached' },
        overallQuality: 'above average',
      });
      if (est) {
        const divergence =
          arv != null && arv > 0 ? round(((est.value - arv) / arv) * 100, 1) : null;
        avm = { value: est.value, divergence_pct: divergence };
      }
    } catch {
      // AVM is a non-essential cross-check; ignore failures.
    }
  }

  const confidence = comps.length >= 5 ? 'high' : comps.length >= 3 ? 'medium' : 'low';
  const thin = comps.length < 3;

  return {
    kind: 'cma',
    payload: {
      recommended_product: `New single-family ~${TARGET_SQFT.toLocaleString()} SF`,
      target_sqft: TARGET_SQFT,
      comps,
      ppsf_low: ppsfLow,
      ppsf_median: ppsfMedian,
      ppsf_high: ppsfHigh,
      arv_low: arvLow,
      arv_high: arvHigh,
      avm_cross_check: avm,
      notes:
        avm && avm.divergence_pct != null && Math.abs(avm.divergence_pct) >= 15
          ? `AVM diverges ${avm.divergence_pct}% from comp-derived ARV — review.`
          : null,
    },
    sources: [
      {
        title: `MLS sold comparables within 1 mi, last 12 mo (${comps.length})`,
        url: 'https://api.repliers.io/listings',
        publisher: 'MLS PIN via Repliers',
      },
    ],
    confidence,
    needsHuman: thin,
    needsHumanReasons: thin ? ['low_confidence_financial'] : [],
  };
};

function distanceMi(lat: number, lng: number, c: MlsListing): number | null {
  if (c.latitude == null || c.longitude == null) return null;
  const R = 3958.8;
  const dLat = ((c.latitude - lat) * Math.PI) / 180;
  const dLng = ((c.longitude - lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat * Math.PI) / 180) *
      Math.cos((c.latitude * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)), 2);
}
