import { ENDPOINTS, getElevationMeters, type LatLng } from '@forge/gis';
import type { TopoPayload } from '../schemas.js';
import type { ResearchProducer } from '../types.js';
import { round, unresolvedResult } from './util.js';

const EMPTY: TopoPayload = {
  center_elev_m: null,
  sample_elevs_m: [],
  relief_m: null,
  slope_pct_est: null,
  walkout_potential: null,
  ledge_risk: null,
};

/** ~half-envelope offset in meters (samples a ~30m building footprint). */
const OFFSET_M = 15;

/**
 * Deterministic: sample the MassGIS 1m LiDAR DEM at the center + four points
 * around a ~30m building envelope to estimate relief and slope. (MassGIS
 * publishes no contour FeatureServer, so we sample the DEM.) Ledge/rock can't be
 * read from a DEM, so ledge_risk stays null — flagged for the zoning/site human
 * pass, not asserted.
 */
export const topoKind: ResearchProducer<TopoPayload> = async (input, deps) => {
  if (input.lat == null || input.lng == null) return unresolvedResult('topo', EMPTY);

  const center: LatLng = { lat: input.lat, lng: input.lng };
  const dLat = OFFSET_M / 111_320;
  const dLng = OFFSET_M / (111_320 * Math.cos((input.lat * Math.PI) / 180));
  const points: LatLng[] = [
    center,
    { lat: input.lat + dLat, lng: input.lng },
    { lat: input.lat - dLat, lng: input.lng },
    { lat: input.lat, lng: input.lng + dLng },
    { lat: input.lat, lng: input.lng - dLng },
  ];

  const elevs = await Promise.all(
    points.map((p) => getElevationMeters(p, { fetchImpl: deps.fetchImpl })),
  );
  const valid = elevs.filter((e): e is number => e != null);

  if (valid.length === 0) {
    return {
      kind: 'topo',
      payload: EMPTY,
      sources: [sourceRef()],
      confidence: 'low',
      needsHuman: true,
      needsHumanReasons: ['data_unavailable'],
    };
  }

  const relief = Math.max(...valid) - Math.min(...valid);
  // slope across the ~30m envelope (relief / horizontal run).
  const slopePct = round((relief / (OFFSET_M * 2)) * 100, 1);

  return {
    kind: 'topo',
    payload: {
      center_elev_m: elevs[0] != null ? round(elevs[0], 2) : null,
      sample_elevs_m: valid.map((e) => round(e, 2)),
      relief_m: round(relief, 2),
      slope_pct_est: slopePct,
      walkout_potential: relief >= 2.4, // ~8 ft of fall supports a walkout
      ledge_risk: null,
    },
    sources: [sourceRef()],
    confidence: valid.length >= 3 ? 'high' : 'medium',
    needsHuman: false,
    needsHumanReasons: [],
  };
};

function sourceRef() {
  return {
    title: 'MassGIS 1m LiDAR DEM (Elevation ImageServer)',
    url: `${ENDPOINTS.massgisElevation.base}/identify`,
    publisher: 'MassGIS',
  };
}
