import { fetchAuthSession } from 'aws-amplify/auth';
import { buildMemoPdf, detailToMemoData, type ParcelDetail } from '@forge/pdf';
import { amplifyConfigured } from '../amplifyConfig';

export interface ParcelRow {
  parcel_id: string | null;
  loc_id: string | null;
  resolution: string;
  address: string | null;
  city: string | null;
  zip: string | null;
  mls_listing_key: string;
  standard_status: string;
  property_type: string | null;
  list_price: number | null;
  lot_acres: number | null;
  modification_ts: string;
  score: number | null;
  rank: number | null;
  profit_mid: number | null;
  flags: { code: string; detail?: string }[];
  summary: string | null;
}

export interface ParcelFilters {
  city?: string;
  propertyType?: string;
  minPrice?: number;
  maxPrice?: number;
  minScore?: number;
}

/** Full detail (superset of the PDF mapper's ParcelDetail — adds geo for the map). */
export interface DetailData extends ParcelDetail {
  parcel:
    | (NonNullable<ParcelDetail['parcel']> & {
        lat?: number | null;
        lng?: number | null;
        lot_geojson?: string | null;
        zoning_code?: string | null;
        lot_acres?: number | null;
      })
    | null;
}

const API_URL = import.meta.env.VITE_API_URL as string | undefined;
export const previewMode = !API_URL;

async function authHeaders(): Promise<Record<string, string>> {
  if (!amplifyConfigured) return {};
  const token = (await fetchAuthSession()).tokens?.idToken?.toString();
  return token ? { authorization: token } : {};
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return (await res.json()) as T;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
  return (await res.json()) as T;
}

export async function fetchParcels(filters: ParcelFilters): Promise<ParcelRow[]> {
  if (previewMode) return MOCK_PARCELS.filter((p) => matchesFilters(p, filters));
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v != null && v !== '') params.set(k, String(v));
  return (await apiGet<{ parcels: ParcelRow[] }>(`/parcels?${params.toString()}`)).parcels;
}

export async function fetchParcelDetail(id: string): Promise<DetailData> {
  if (previewMode) return MOCK_DETAIL[id] ?? MOCK_DETAIL['mock-1'];
  return apiGet<DetailData>(`/parcels/${encodeURIComponent(id)}`);
}

export async function saveScenario(
  id: string,
  body: { name: string; land?: number; inputs?: Record<string, number> },
): Promise<{ scenario: string }> {
  if (previewMode) return { scenario: `user:preview:${body.name}` };
  return apiPost(`/parcels/${encodeURIComponent(id)}/proforma`, body);
}

export async function toggleWatch(id: string): Promise<{ watched: boolean }> {
  if (previewMode) return { watched: true };
  return apiPost(`/parcels/${encodeURIComponent(id)}/watch`, {});
}

export async function reresearch(id: string): Promise<{ busted: boolean }> {
  if (previewMode) return { busted: true };
  return apiPost(`/parcels/${encodeURIComponent(id)}/reresearch`, {});
}

/**
 * Generate the memo. In preview we build the PDF client-side (pdf-lib runs in the
 * browser) and trigger a download. In prod the server stores it in S3 and returns
 * a presigned URL we open.
 */
export async function requestReport(id: string): Promise<{ opened: boolean }> {
  const today = new Date().toISOString().slice(0, 10);
  if (previewMode) {
    const detail = await fetchParcelDetail(id);
    const bytes = await buildMemoPdf(detailToMemoData(detail, today));
    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `forge-memo-${id}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
    return { opened: true };
  }
  const { url } = await apiGet<{ url: string }>(`/parcels/${encodeURIComponent(id)}/report.pdf`);
  window.open(url, '_blank');
  return { opened: true };
}

function matchesFilters(p: ParcelRow, f: ParcelFilters): boolean {
  if (f.city && (p.city ?? '').toLowerCase() !== f.city.toLowerCase()) return false;
  if (f.propertyType && p.property_type !== f.propertyType) return false;
  if (f.minPrice != null && (p.list_price ?? 0) < f.minPrice) return false;
  if (f.maxPrice != null && (p.list_price ?? Infinity) > f.maxPrice) return false;
  if (f.minScore != null && (p.score ?? -1) < f.minScore) return false;
  return true;
}

// ---- preview-mode sample data ---------------------------------------------

const MOCK_PARCELS: ParcelRow[] = [
  {
    parcel_id: 'mock-1',
    loc_id: 'M_201_842',
    resolution: 'l3',
    address: '33 Russo Dr, Hopkinton, MA 01748',
    city: 'Hopkinton',
    zip: '01748',
    mls_listing_key: '73000001',
    standard_status: 'Closed',
    property_type: 'Land',
    list_price: 250000,
    lot_acres: 1.5,
    modification_ts: '2025-04-16T10:00:00Z',
    score: 82,
    rank: 1,
    profit_mid: 168000,
    flags: [{ code: 'frontage_variance', detail: 'frontage short of RA minimum' }],
    summary: 'Approved build lot, 14 mo DOM, two price cuts — offer well under ask.',
  },
  {
    parcel_id: 'mock-2',
    loc_id: 'F_118_330',
    resolution: 'l3',
    address: '12 Elm St, Framingham, MA 01701',
    city: 'Framingham',
    zip: '01701',
    mls_listing_key: '73000002',
    standard_status: 'Active',
    property_type: 'Residential',
    list_price: 614900,
    lot_acres: 0.34,
    modification_ts: '2025-06-02T08:30:00Z',
    score: 54,
    rank: 2,
    profit_mid: 71000,
    flags: [{ code: 'thin_comps' }],
    summary: 'Tear-down candidate; comps thin in immediate area.',
  },
  {
    parcel_id: 'mock-3',
    loc_id: null,
    resolution: 'unresolved',
    address: 'Lot 4 Pinewood Rd, Natick, MA',
    city: 'Natick',
    zip: '01760',
    mls_listing_key: '73000003',
    standard_status: 'Active',
    property_type: 'Land',
    list_price: 399000,
    lot_acres: 2.1,
    modification_ts: '2025-06-03T00:00:00Z',
    score: null,
    rank: null,
    profit_mid: null,
    flags: [{ code: 'low_data_confidence', detail: 'no street address — parcel unresolved' }],
    summary: 'Raw land with no street address; held for human parcel resolution.',
  },
];

const MOCK_DETAIL: Record<string, DetailData> = {
  'mock-1': {
    parcel: {
      id: 'mock-1',
      loc_id: 'M_201_842',
      address: '33 Russo Dr, Hopkinton, MA 01748',
      city: 'Hopkinton',
      lat: 42.2287,
      lng: -71.5226,
      zoning_code: 'RA',
      lot_acres: 1.5,
      lot_geojson: JSON.stringify({
        type: 'Polygon',
        coordinates: [
          [
            [-71.5232, 42.2283],
            [-71.522, 42.2283],
            [-71.522, 42.2291],
            [-71.5232, 42.2291],
            [-71.5232, 42.2283],
          ],
        ],
      }),
    },
    listings: [{ list_price: 250000, standard_status: 'Closed' }],
    research: [
      {
        kind: 'zoning',
        payload: {
          district: 'RA (Residence A)',
          min_lot_sqft: 60000,
          min_frontage_ft: 175,
          setbacks: { front: 30, side: 15, rear: 30 },
          max_coverage_pct: 20,
          max_height_ft: 35,
          allowed_uses: ['single-family'],
          adu_allowed: true,
          lot_of_record_protection: true,
          variance_needed: ['frontage 150 ft < 175 ft RA minimum'],
          notes: 'Pre-existing lot of record; ADU by-right since Feb 2025.',
        },
        confidence: 'medium',
        needs_human: false,
        sources: [{ title: 'Hopkinton Zoning Bylaw §210-12', url: 'https://www.hopkintonma.gov/zoning' }],
      },
      {
        kind: 'flood',
        payload: { flood_zone: 'X', zone_subtype: 'AREA OF MINIMAL FLOOD HAZARD', mapped: true, in_sfha: false },
        confidence: 'high',
        needs_human: false,
        sources: [{ title: 'FEMA NFHL layer 28', url: 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28' }],
      },
      {
        kind: 'wetlands',
        payload: { intersects: false, types: [], screening_only: true },
        confidence: 'medium',
        needs_human: false,
        sources: [{ title: 'MassDEP Wetlands (2005)', url: 'https://services1.arcgis.com/hGdibHYSPO59RG1h/arcgis/rest/services/DEP_Wetlands/FeatureServer/0' }],
      },
      {
        kind: 'topo',
        payload: { center_elev_m: 119.2, sample_elevs_m: [119.2, 121, 117.8, 120.1, 118.4], relief_m: 3.2, slope_pct_est: 10.7, walkout_potential: true, ledge_risk: null },
        confidence: 'high',
        needs_human: false,
        sources: [{ title: 'MassGIS 1m LiDAR DEM', url: 'https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/LiDAR/Elevation_LiDAR_INT/ImageServer/identify' }],
      },
      {
        kind: 'ownership',
        payload: { owner: 'RUSSO FAMILY TRUST', use_code: '130', lot_acres: 1.5, assessed_total: 188400, land_val: 188400, fy: 2025, last_sale_date: '2011-05-12', last_sale_price: 95000, hold_years: 14.1 },
        confidence: 'high',
        needs_human: false,
        sources: [{ title: 'MassGIS L3 parcels (FY2025)', url: 'https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/AGOL/L3Parcels_feature_service/MapServer/0' }],
      },
      {
        kind: 'cma',
        payload: {
          recommended_product: 'New single-family ~3,200 SF',
          target_sqft: 3200,
          comps: [
            { address: '5 Oak St, Hopkinton', sold_price: 1010000, sqft: 3100, ppsf: 326, sold_date: '2025-03-18', distance_mi: 0.6 },
            { address: '21 Maple Way, Hopkinton', sold_price: 965000, sqft: 3000, ppsf: 322, sold_date: '2025-02-02', distance_mi: 0.8 },
            { address: '9 Birch Ln, Hopkinton', sold_price: 1085000, sqft: 3400, ppsf: 319, sold_date: '2025-04-30', distance_mi: 0.9 },
          ],
          ppsf_low: 319,
          ppsf_median: 322,
          ppsf_high: 326,
          arv_low: 1020800,
          arv_high: 1043200,
          avm_cross_check: { value: 1005000, divergence_pct: -3.0 },
          notes: null,
        },
        confidence: 'high',
        needs_human: false,
        sources: [{ title: 'MLS PIN sold comps (3) via Repliers', url: 'https://api.repliers.io/listings' }],
      },
    ],
    proFormas: [
      {
        scenario: 'auto',
        inputs: { land: 185000, recommended_product: 'New single-family ~3,200 SF', all_in_cash_cap: 700000, target_sqft: 3200, hard_cost_psf_low: 150, hard_cost_psf_high: 185, site_work_low: 40000, site_work_high: 50000, soft_costs_low: 20000, soft_costs_high: 25000, carry_low: 20000, carry_high: 25000, utility_connections: 0, sell_cost_pct: 0.05 },
        arv_low: 1020800,
        arv_high: 1043200,
        allin_low: 745000,
        allin_high: 877000,
        profit_low: 92760,
        profit_high: 246040,
      },
    ],
    score: {
      score: 82,
      profit_mid: 169400,
      flags: [{ code: 'frontage_variance', detail: 'frontage 150 ft < 175 ft RA minimum' }],
      summary:
        'New single-family ~3,200 SF. ARV $1,020,800–$1,043,200, all-in $745,000–$877,000, profit $92,760–$246,040 (mid $169,400). Recommended offer $185,000. Over cash cap (peak $877,000) — consider ~2,100 SF. Risks: frontage_variance.',
    },
  },
};
