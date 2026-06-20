import type { FetchLike, LatLng } from './arcgis.js';
import { identifyImageAtPoint } from './arcgis.js';
import { ENDPOINTS } from './endpoints.js';

/**
 * Sample the MassGIS 1m LiDAR DEM at a point (meters). Phase 2 (topo research
 * kind) samples the DEM across the building envelope to estimate slope rather
 * than expecting a contour FeatureServer (MassGIS doesn't publish one).
 */
export async function getElevationMeters(
  point: LatLng,
  opts: { fetchImpl?: FetchLike } = {},
): Promise<number | null> {
  return identifyImageAtPoint(ENDPOINTS.massgisElevation.base, point, opts);
}
