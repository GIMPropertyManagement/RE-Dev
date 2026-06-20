import type { Confidence, RiskFlag } from '@forge/shared';
import type {
  CmaPayload,
  FloodPayload,
  TopoPayload,
  WetlandsPayload,
  ZoningPayload,
} from '@forge/research';
import type { ProFormaResult } from './proforma.js';

/** Research payloads pulled out of the orchestrator's by-kind result bag. */
export interface ResearchBag {
  flood?: FloodPayload;
  wetlands?: WetlandsPayload;
  topo?: TopoPayload;
  zoning?: ZoningPayload;
  cma?: CmaPayload;
}

export function deriveFlags(
  bag: ResearchBag,
  proForma: ProFormaResult,
  confidence: Confidence,
): RiskFlag[] {
  const flags: RiskFlag[] = [];

  if (bag.flood?.in_sfha) {
    flags.push({ code: 'flood_zone', detail: `FEMA zone ${bag.flood.flood_zone ?? '?'}` });
  }
  if (bag.wetlands?.intersects) {
    flags.push({ code: 'wetlands', detail: bag.wetlands.types.join(', ') || 'wetland intersect' });
  }
  if (bag.topo?.slope_pct_est != null && bag.topo.slope_pct_est >= 15) {
    flags.push({ code: 'steep_slope', detail: `~${bag.topo.slope_pct_est}% across envelope` });
  }
  if (bag.topo?.ledge_risk === true) {
    flags.push({ code: 'ledge_risk' });
  }
  if (bag.zoning?.variance_needed && bag.zoning.variance_needed.length > 0) {
    flags.push({ code: 'frontage_variance', detail: bag.zoning.variance_needed.join('; ') });
  }
  if (bag.cma && bag.cma.comps.length < 3) {
    flags.push({ code: 'thin_comps', detail: `${bag.cma.comps.length} comps` });
  }
  if (!proForma.fits_cap) {
    flags.push({ code: 'over_cash_cap', detail: `peak cash $${proForma.peak_cash.toLocaleString()}` });
  }
  if (confidence === 'low') {
    flags.push({ code: 'low_data_confidence' });
  }

  return flags;
}
