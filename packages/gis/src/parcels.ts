import type { FetchLike, LatLng } from './arcgis.js';
import { queryLayerAtPoint } from './arcgis.js';
import { CENSUS_GEOCODER, ENDPOINTS } from './endpoints.js';

/**
 * MassGIS L3 standardized assessor attributes (the subset we read). The L3
 * parcels layer is NOT geometry-only — it carries the full assessor table, so
 * owner/value/use/lot-size/last-sale come back as JSON with no scraping.
 * Freshness: annual snapshot; always carry the FY/as-of with the value.
 */
export interface L3Attributes {
  LOC_ID?: string;
  MAP_PAR_ID?: string;
  OWNER1?: string;
  SITE_ADDR?: string;
  USE_CODE?: string;
  LOT_SIZE?: number; // acres
  ZONING?: string;
  LAND_VAL?: number;
  BLDG_VAL?: number;
  OTHER_VAL?: number;
  TOTAL_VAL?: number;
  FY?: number; // fiscal year of the assessment
  YEAR_BUILT?: number;
  BLD_AREA?: number;
  RES_AREA?: number;
  UNITS?: number;
  STYLE?: string;
  LS_DATE?: string; // last sale
  LS_PRICE?: number;
  LS_BOOK?: string;
  LS_PAGE?: string;
}

export interface ParcelResolution {
  /** 'l3' when exactly one parcel intersects; 'unresolved' for 0 or >1. */
  resolution: 'l3' | 'unresolved';
  point: LatLng | null;
  candidateCount: number;
  locId: string | null;
  apn: string | null;
  attributes: L3Attributes | null;
}

/**
 * Resolve a listing to a stable parcel. Prefers the listing's own lat/lng;
 * falls back to geocoding the address. Then does a point-in-polygon query
 * against MassGIS L3. Exactly-one-intersect => resolved; anything else =>
 * 'unresolved' (held for human review — never guess a parcel identity).
 */
export async function resolveParcel(
  input: { lat?: number | null; lng?: number | null; address?: string | null },
  opts: { fetchImpl?: FetchLike } = {},
): Promise<ParcelResolution> {
  let point: LatLng | null =
    input.lat != null && input.lng != null ? { lat: input.lat, lng: input.lng } : null;

  if (!point && input.address) {
    point = await geocodeAddress(input.address, opts);
  }
  if (!point) {
    return { resolution: 'unresolved', point: null, candidateCount: 0, locId: null, apn: null, attributes: null };
  }

  const { base, layer } = ENDPOINTS.massgisL3Parcels;
  const features = await queryLayerAtPoint<L3Attributes>(`${base}/${layer}`, point, {
    returnGeometry: false,
    fetchImpl: opts.fetchImpl,
  });

  if (features.length !== 1) {
    return { resolution: 'unresolved', point, candidateCount: features.length, locId: null, apn: null, attributes: null };
  }

  const attrs = features[0].attributes;
  return {
    resolution: 'l3',
    point,
    candidateCount: 1,
    locId: attrs.LOC_ID ?? null,
    apn: attrs.MAP_PAR_ID ?? null,
    attributes: attrs,
  };
}

/** Free US Census one-line geocoder (no key). Returns null if not matched. */
export async function geocodeAddress(
  address: string,
  opts: { fetchImpl?: FetchLike } = {},
): Promise<LatLng | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const params = new URLSearchParams({
    address,
    benchmark: 'Public_AR_Current',
    format: 'json',
  });
  const res = await fetchImpl(`${CENSUS_GEOCODER}?${params.toString()}`);
  if (!res.ok) return null;
  const body = (await res.json()) as {
    result?: { addressMatches?: { coordinates?: { x: number; y: number } }[] };
  };
  const match = body.result?.addressMatches?.[0]?.coordinates;
  if (!match) return null;
  return { lat: match.y, lng: match.x };
}
