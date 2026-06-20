import type { FetchLike, LatLng } from './arcgis.js';
import { queryLayerAtPoint } from './arcgis.js';
import { ENDPOINTS } from './endpoints.js';

export interface FloodResult {
  /** RESO/FEMA flood zone, e.g. 'X', 'AE', 'VE'. null when unmapped. */
  floodZone: string | null;
  zoneSubtype: string | null;
  /**
   * True only when FEMA actually returned a mapped zone. An EMPTY result is NOT
   * "no flood risk" — the area may be unmapped/preliminary. Surface as unknown.
   */
  mapped: boolean;
}

/** Query FEMA NFHL flood hazard zone at a point. Phase 2 (flood research kind). */
export async function getFloodZone(
  point: LatLng,
  opts: { fetchImpl?: FetchLike } = {},
): Promise<FloodResult> {
  const { base, floodHazardZonesLayer } = ENDPOINTS.femaNfhl;
  const features = await queryLayerAtPoint<{ FLD_ZONE?: string; ZONE_SUBTY?: string }>(
    `${base}/${floodHazardZonesLayer}`,
    point,
    { outFields: 'FLD_ZONE,ZONE_SUBTY', fetchImpl: opts.fetchImpl },
  );
  if (features.length === 0) return { floodZone: null, zoneSubtype: null, mapped: false };
  const a = features[0].attributes;
  return { floodZone: a.FLD_ZONE ?? null, zoneSubtype: a.ZONE_SUBTY ?? null, mapped: true };
}
