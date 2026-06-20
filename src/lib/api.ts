import { fetchAuthSession } from 'aws-amplify/auth';
import { amplifyConfigured } from '../amplifyConfig';

/** View model returned by GET /parcels (mirrors the API's ParcelRow). */
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

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

/** True when there's no real backend yet — the dashboard renders sample data. */
export const previewMode = !API_URL;

export async function fetchParcels(filters: ParcelFilters): Promise<ParcelRow[]> {
  if (!API_URL) return MOCK_PARCELS.filter((p) => matchesFilters(p, filters));

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v != null && v !== '') params.set(k, String(v));
  }

  const headers: Record<string, string> = {};
  if (amplifyConfigured) {
    const token = (await fetchAuthSession()).tokens?.idToken?.toString();
    if (token) headers.authorization = token;
  }

  const res = await fetch(`${API_URL}/parcels?${params.toString()}`, { headers });
  if (!res.ok) throw new Error(`GET /parcels failed: ${res.status}`);
  const body = (await res.json()) as { parcels: ParcelRow[] };
  return body.parcels;
}

function matchesFilters(p: ParcelRow, f: ParcelFilters): boolean {
  if (f.city && (p.city ?? '').toLowerCase() !== f.city.toLowerCase()) return false;
  if (f.propertyType && p.property_type !== f.propertyType) return false;
  if (f.minPrice != null && (p.list_price ?? 0) < f.minPrice) return false;
  if (f.maxPrice != null && (p.list_price ?? Infinity) > f.maxPrice) return false;
  if (f.minScore != null && (p.score ?? -1) < f.minScore) return false;
  return true;
}

/** Sample rows (preview mode only). Includes the 33 Russo Drive reference deal. */
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
    parcel_id: null,
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
