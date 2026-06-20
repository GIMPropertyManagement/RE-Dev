/** Minimal headless ArcGIS REST helpers (query + identify), dependency-free. */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface ArcgisFeature<A = Record<string, unknown>> {
  attributes: A;
  geometry?: unknown;
}

interface QueryResponse<A> {
  features?: ArcgisFeature<A>[];
  error?: { code: number; message: string };
}

export type FetchLike = typeof fetch;

/**
 * Point-intersect query against a MapServer/FeatureServer layer. Returns the
 * intersecting features' attributes (and geometry if requested).
 */
export async function queryLayerAtPoint<A = Record<string, unknown>>(
  layerUrl: string,
  point: LatLng,
  opts: { outFields?: string; returnGeometry?: boolean; fetchImpl?: FetchLike } = {},
): Promise<ArcgisFeature<A>[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const params = new URLSearchParams({
    geometry: `${point.lng},${point.lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: opts.outFields ?? '*',
    returnGeometry: String(opts.returnGeometry ?? false),
    outSR: '4326',
    f: 'json',
  });
  const res = await fetchImpl(`${layerUrl}/query?${params.toString()}`);
  if (!res.ok) throw new Error(`ArcGIS query ${res.status} for ${layerUrl}`);
  const body = (await res.json()) as QueryResponse<A>;
  if (body.error) throw new Error(`ArcGIS error ${body.error.code}: ${body.error.message}`);
  return body.features ?? [];
}

/**
 * ImageServer identify at a point. NOTE the verified gotcha: the MassGIS LiDAR
 * ImageServer is native Web Mercator and returns NoData for a bare 4326 pair —
 * the geometry MUST be a JSON object with an explicit spatialReference. We pass
 * 4326 with spatialReference and let the server reproject.
 */
export async function identifyImageAtPoint(
  imageServerUrl: string,
  point: LatLng,
  opts: { fetchImpl?: FetchLike } = {},
): Promise<number | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const geometry = JSON.stringify({
    x: point.lng,
    y: point.lat,
    spatialReference: { wkid: 4326 },
  });
  const params = new URLSearchParams({
    geometry,
    geometryType: 'esriGeometryPoint',
    returnGeometry: 'false',
    f: 'json',
  });
  const res = await fetchImpl(`${imageServerUrl}/identify?${params.toString()}`);
  if (!res.ok) throw new Error(`ArcGIS identify ${res.status}`);
  const body = (await res.json()) as { value?: string };
  if (body.value == null || body.value === 'NoData') return null;
  const n = Number(body.value);
  return Number.isFinite(n) ? n : null;
}
