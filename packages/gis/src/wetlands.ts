import type { FetchLike, LatLng } from './arcgis.js';
import { queryLayerAtPoint } from './arcgis.js';
import { ENDPOINTS } from './endpoints.js';

export interface WetlandsResult {
  intersects: boolean;
  /** Wetland type codes (IT_VALDESC / WETCODE) at the point, if any. */
  types: string[];
  /**
   * The MassDEP layer is 2005 vintage — this is a SCREENING flag only. Any
   * setback/buffer determination must be flagged needs_human (wetland scientist).
   */
  screeningOnly: true;
}

/** Screen a point against MassDEP wetlands. Phase 2 (wetlands research kind). */
export async function getWetlands(
  point: LatLng,
  opts: { fetchImpl?: FetchLike } = {},
): Promise<WetlandsResult> {
  const { base, layer } = ENDPOINTS.massDepWetlands;
  const features = await queryLayerAtPoint<{ IT_VALDESC?: string; WETCODE?: string }>(
    `${base}/${layer}`,
    point,
    { outFields: 'IT_VALDESC,WETCODE', fetchImpl: opts.fetchImpl },
  );
  const types = features
    .map((f) => f.attributes.IT_VALDESC ?? f.attributes.WETCODE)
    .filter((t): t is string => !!t);
  return { intersects: features.length > 0, types, screeningOnly: true };
}
