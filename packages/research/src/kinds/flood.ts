import { ENDPOINTS, getFloodZone } from '@forge/gis';
import type { FloodPayload } from '../schemas.js';
import type { ResearchProducer } from '../types.js';
import { unresolvedResult } from './util.js';

const EMPTY: FloodPayload = { flood_zone: null, zone_subtype: null, mapped: false, in_sfha: null };

/**
 * Deterministic: FEMA NFHL flood zone at the parcel point. No LLM. The source IS
 * the government endpoint, so confidence is high when FEMA returns a mapped zone.
 * An EMPTY result is NOT "no risk" — the area may be unmapped/preliminary, so we
 * flag needs_human in that case rather than implying Zone X.
 */
export const floodKind: ResearchProducer<FloodPayload> = async (input, deps) => {
  if (input.lat == null || input.lng == null) return unresolvedResult('flood', EMPTY);

  const r = await getFloodZone({ lat: input.lat, lng: input.lng }, { fetchImpl: deps.fetchImpl });
  const in_sfha = r.floodZone ? /^(A|V)/i.test(r.floodZone) : null;

  return {
    kind: 'flood',
    payload: { flood_zone: r.floodZone, zone_subtype: r.zoneSubtype, mapped: r.mapped, in_sfha },
    sources: [
      {
        title: 'FEMA National Flood Hazard Layer — Flood Hazard Zones (layer 28)',
        url: `${ENDPOINTS.femaNfhl.base}/${ENDPOINTS.femaNfhl.floodHazardZonesLayer}`,
        publisher: 'FEMA',
      },
    ],
    confidence: r.mapped ? 'high' : 'low',
    needsHuman: !r.mapped,
    needsHumanReasons: r.mapped ? [] : ['data_unavailable'],
  };
};
