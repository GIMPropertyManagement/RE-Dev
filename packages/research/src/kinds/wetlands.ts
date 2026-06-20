import { ENDPOINTS, getWetlands } from '@forge/gis';
import type { WetlandsPayload } from '../schemas.js';
import type { ResearchProducer } from '../types.js';
import { unresolvedResult } from './util.js';

const EMPTY: WetlandsPayload = { intersects: false, types: [], screening_only: true };

/**
 * Deterministic: MassDEP wetlands screen at the parcel point. The layer is 2005
 * vintage, so this is ALWAYS a screen — a hit (or a near-miss) requires a wetland
 * scientist's delineation before any buffer/setback conclusion. So confidence is
 * capped at medium and a hit flags needs_human (screening_only).
 */
export const wetlandsKind: ResearchProducer<WetlandsPayload> = async (input, deps) => {
  if (input.lat == null || input.lng == null) return unresolvedResult('wetlands', EMPTY);

  const r = await getWetlands({ lat: input.lat, lng: input.lng }, { fetchImpl: deps.fetchImpl });

  return {
    kind: 'wetlands',
    payload: { intersects: r.intersects, types: r.types, screening_only: true },
    sources: [
      {
        title: 'MassDEP Wetlands (MassGIS, 2005) — screening layer',
        url: `${ENDPOINTS.massDepWetlands.base}/${ENDPOINTS.massDepWetlands.layer}`,
        publisher: 'MassGIS / MassDEP',
      },
    ],
    confidence: 'medium',
    needsHuman: r.intersects,
    needsHumanReasons: r.intersects ? ['screening_only'] : [],
  };
};
