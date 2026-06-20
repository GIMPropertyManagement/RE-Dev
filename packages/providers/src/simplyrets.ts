import type {
  FetchChangedOpts,
  MlsListing,
  MlsProvider,
  PropertyType,
  SoldCompsParams,
  StandardStatus,
} from '@forge/shared';

/**
 * SimplyRetsProvider — a SECOND MlsProvider implementation, present to prove the
 * vendor seam: swapping the launch feed is a one-file change behind the same
 * interface. SimplyRETS resells the same MLS PIN source, uses HTTP Basic auth
 * (apiKey:apiSecret; demo creds simplyrets/simplyrets), and returns its own JSON
 * shape that we normalize into the RESO model.
 *
 * Pragmatic incremental sync: SimplyRETS paginates via `lastId` and has no clean
 * "modified since" filter, so we page newest-first and stop once we pass the
 * watermark (CONFIRM against a live account when adopting this provider).
 */
export interface SimplyRetsConfig {
  apiKey: string;
  apiSecret: string;
  baseUrl?: string; // default https://api.simplyrets.com
  pageSize?: number;
  fetchImpl?: typeof fetch;
}

export interface SimplyRetsRawListing {
  mlsId?: number;
  listingId?: string;
  listDate?: string;
  modified?: string;
  listPrice?: number;
  originalListPrice?: number;
  remarks?: string;
  address?: {
    full?: string;
    streetNumber?: string;
    streetName?: string;
    unit?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };
  geo?: { lat?: number; lng?: number; county?: string };
  property?: {
    type?: string; // RES | CND | MLF | LND | COM | FRM
    subType?: string;
    area?: number; // living area sqft
    lotSize?: string;
    lotSizeArea?: number;
    lotSizeUnits?: string; // Acres | Square Feet
    yearBuilt?: number;
    zoning?: string;
  };
  mls?: { status?: string; daysOnMarket?: number };
  sales?: { closeDate?: string; closePrice?: number };
  [k: string]: unknown;
}

const STATUS_MAP: Record<string, StandardStatus> = {
  Active: 'Active',
  'Active Under Contract': 'ActiveUnderContract',
  Pending: 'Pending',
  Closed: 'Closed',
  Expired: 'Expired',
  Withdrawn: 'Withdrawn',
  Canceled: 'Canceled',
  ComingSoon: 'ComingSoon',
};

const TYPE_MAP: Record<string, PropertyType> = {
  RES: 'Residential',
  CND: 'Residential',
  MLF: 'ResidentialIncome',
  LND: 'Land',
  COM: 'CommercialSale',
  FRM: 'Farm',
  RNT: 'ResidentialLease',
};

export function normalizeSimplyRetsListing(raw: SimplyRetsRawListing): MlsListing {
  const acres =
    raw.property?.lotSizeUnits?.toLowerCase().startsWith('acre')
      ? raw.property?.lotSizeArea
      : raw.property?.lotSizeArea != null
        ? raw.property.lotSizeArea / 43560
        : undefined;
  const sqft =
    raw.property?.lotSizeUnits?.toLowerCase().startsWith('square')
      ? raw.property?.lotSizeArea
      : acres != null
        ? Math.round(acres * 43560)
        : undefined;

  return {
    listingKey: String(raw.mlsId ?? raw.listingId ?? ''),
    listingId: raw.listingId ?? (raw.mlsId != null ? String(raw.mlsId) : undefined),
    standardStatus: STATUS_MAP[raw.mls?.status ?? ''] ?? 'Unknown',
    mlsStatus: raw.mls?.status,
    propertyType: TYPE_MAP[raw.property?.type ?? ''] ?? 'Unknown',
    propertySubType: raw.property?.subType,
    listPrice: raw.listPrice,
    originalListPrice: raw.originalListPrice,
    closePrice: raw.sales?.closePrice,
    listingContractDate: raw.listDate?.slice(0, 10),
    closeDate: raw.sales?.closeDate?.slice(0, 10),
    daysOnMarket: raw.mls?.daysOnMarket,
    modificationTimestamp: raw.modified ?? raw.listDate ?? new Date(0).toISOString(),
    unparsedAddress: raw.address?.full,
    streetNumber: raw.address?.streetNumber,
    streetName: raw.address?.streetName,
    city: raw.address?.city,
    stateOrProvince: raw.address?.state,
    postalCode: raw.address?.postalCode,
    countyOrParish: raw.geo?.county,
    latitude: raw.geo?.lat,
    longitude: raw.geo?.lng,
    lotSizeAcres: acres != null ? Math.round(acres * 100) / 100 : undefined,
    lotSizeSquareFeet: sqft,
    zoning: raw.property?.zoning,
    livingArea: raw.property?.area,
    yearBuilt: raw.property?.yearBuilt,
    publicRemarks: raw.remarks,
    raw,
  };
}

export class SimplyRetsProvider implements MlsProvider {
  readonly name = 'simplyrets';
  private readonly baseUrl: string;
  private readonly pageSize: number;
  private readonly fetchImpl: typeof fetch;
  private readonly auth: string;

  constructor(cfg: SimplyRetsConfig) {
    if (!cfg.apiKey || !cfg.apiSecret) throw new Error('SimplyRetsProvider: apiKey+apiSecret required');
    this.baseUrl = (cfg.baseUrl ?? 'https://api.simplyrets.com').replace(/\/$/, '');
    this.pageSize = cfg.pageSize ?? 100;
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    this.auth = `Basic ${base64(`${cfg.apiKey}:${cfg.apiSecret}`)}`;
  }

  async *fetchChangedSince(
    since: string | null,
    opts: FetchChangedOpts = {},
  ): AsyncIterable<MlsListing> {
    let offset = 0;
    const limit = opts.pageSize ?? this.pageSize;
    for (;;) {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset), sort: '-modified' });
      params.append('status', 'Active');
      params.append('status', 'Closed');
      const page = await this.get<SimplyRetsRawListing[]>('/properties', params, opts.signal);
      if (!page.length) break;
      let advanced = false;
      for (const raw of page) {
        const listing = normalizeSimplyRetsListing(raw);
        if (since && listing.modificationTimestamp <= since) return; // newest-first → done
        advanced = true;
        yield listing;
      }
      if (!advanced || page.length < limit) break;
      offset += limit;
    }
  }

  async fetchById(listingKey: string): Promise<MlsListing | null> {
    try {
      const raw = await this.get<SimplyRetsRawListing>(`/properties/${encodeURIComponent(listingKey)}`);
      return raw && raw.mlsId != null ? normalizeSimplyRetsListing(raw) : null;
    } catch {
      return null;
    }
  }

  async fetchSoldComps(params: SoldCompsParams): Promise<MlsListing[]> {
    const q = new URLSearchParams({
      status: 'Closed',
      limit: '100',
      q: `${params.lat},${params.lng}`,
      radius: String(params.radiusMi),
    });
    if (params.minSqft != null) q.set('minarea', String(params.minSqft));
    const page = await this.get<SimplyRetsRawListing[]>('/properties', q);
    return page.map(normalizeSimplyRetsListing);
  }

  private async get<T>(path: string, params?: URLSearchParams, signal?: AbortSignal): Promise<T> {
    const qs = params && [...params.keys()].length ? `?${params.toString()}` : '';
    const res = await this.fetchImpl(`${this.baseUrl}${path}${qs}`, {
      headers: { authorization: this.auth, accept: 'application/json' },
      signal,
    });
    if (!res.ok) throw new Error(`SimplyRETS HTTP ${res.status}`);
    return (await res.json()) as T;
  }
}

function base64(s: string): string {
  // Works in Node (Buffer) and the browser (btoa).
  if (typeof Buffer !== 'undefined') return Buffer.from(s).toString('base64');
  return btoa(s);
}
