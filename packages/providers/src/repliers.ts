import type {
  AvmEstimate,
  EstimateParams,
  FetchChangedOpts,
  MlsListing,
  MlsProvider,
  SoldCompsParams,
} from '@forge/shared';
import { normalizeRepliersListing, type RepliersRawListing } from './normalize.js';

/**
 * RepliersProvider — Phase-1 launch feed.
 *
 * Server base https://api.repliers.io, header `REPLIERS-API-KEY`. Server-side
 * only: we never use the client-side base (csr-api.repliers.io) or expose the
 * key to the browser. All calls run from Lambda with the key pulled from
 * Secrets Manager.
 *
 * Verified facts baked in (2026-06):
 *  - `/listings` must be POST for body-based queries (image/bundled); GET works
 *    for simple filtered search + statistics + clusters. We use GET for sync.
 *  - AVM is POST /estimates (create-then-read with property attributes).
 *  - 1M requests/mo is PER BOARD; overage bills linearly with no hard stop, so
 *    we cap page sizes and rely on the watermark to avoid full scans.
 *
 * TODO(sandbox): three params are marked CONFIRM below — the exact incremental
 * "updated since" filter, the sold-comps radius unit, and the estimates request
 * body shape. They're isolated here so confirming them against a real sandbox
 * key is a one-spot change. Normalization (normalize.ts) is already locked.
 */

export interface RepliersConfig {
  apiKey: string;
  baseUrl?: string; // default https://api.repliers.io
  /** boardId, required on multi-board keys. */
  boardId?: number;
  pageSize?: number; // default 100
  fetchImpl?: typeof fetch; // injectable for tests
}

interface RepliersListingsResponse {
  listings?: RepliersRawListing[];
  count?: number;
  numPages?: number;
  page?: number;
}

export class RepliersProvider implements MlsProvider {
  readonly name = 'repliers';
  private readonly baseUrl: string;
  private readonly pageSize: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly cfg: RepliersConfig) {
    if (!cfg.apiKey) throw new Error('RepliersProvider: apiKey is required');
    this.baseUrl = (cfg.baseUrl ?? 'https://api.repliers.io').replace(/\/$/, '');
    this.pageSize = cfg.pageSize ?? 100;
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  async *fetchChangedSince(
    since: string | null,
    opts: FetchChangedOpts = {},
  ): AsyncIterable<MlsListing> {
    const pageSize = opts.pageSize ?? this.pageSize;
    let pageNum = 1;
    let numPages = 1;

    do {
      const params = new URLSearchParams();
      params.set('resultsPerPage', String(pageSize));
      params.set('pageNum', String(pageNum));
      // Ascending by update time so the watermark advances monotonically.
      params.set('sortBy', 'updatedOnAsc');
      // Ingest ALL statuses (active + off-market) so we capture sold/expired too.
      params.set('status', 'U');
      params.append('status', 'A');
      if (since) {
        // CONFIRM(sandbox): exact "updated since" param name. `minUpdatedOn` is
        // the expected name; we also client-side filter below as a safety net.
        params.set('minUpdatedOn', since);
      }
      for (const t of opts.propertyTypes ?? []) params.append('propertyType', t);
      if (this.cfg.boardId != null) params.set('boardId', String(this.cfg.boardId));

      const body = await this.get<RepliersListingsResponse>('/listings', params, opts.signal);
      const listings = body.listings ?? [];
      numPages = body.numPages ?? 1;

      for (const raw of listings) {
        const listing = normalizeRepliersListing(raw);
        // Safety net: skip anything at/under the watermark even if the server
        // filter is imprecise, so we never re-emit already-synced rows.
        if (since && listing.modificationTimestamp <= since) continue;
        yield listing;
      }
      pageNum += 1;
    } while (pageNum <= numPages && !opts.signal?.aborted);
  }

  async fetchById(listingKey: string): Promise<MlsListing | null> {
    const params = new URLSearchParams();
    if (this.cfg.boardId != null) params.set('boardId', String(this.cfg.boardId));
    try {
      const raw = await this.get<RepliersRawListing>(
        `/listings/${encodeURIComponent(listingKey)}`,
        params,
      );
      if (!raw || (!raw.mlsNumber && !raw.status)) return null;
      return normalizeRepliersListing(raw);
    } catch (err) {
      if (err instanceof RepliersHttpError && err.status === 404) return null;
      throw err;
    }
  }

  async fetchSoldComps(params: SoldCompsParams): Promise<MlsListing[]> {
    const minSoldDate = monthsAgoIso(params.soldSinceMonths);
    const q = new URLSearchParams();
    q.set('status', 'U');
    q.set('lastStatus', 'Sld');
    q.set('lat', String(params.lat));
    q.set('long', String(params.lng));
    // CONFIRM(sandbox): radius unit. Repliers `radius` is documented in km;
    // convert miles -> km here and verify once live.
    q.set('radius', String(round2(params.radiusMi * 1.60934)));
    q.set('minSoldDate', minSoldDate);
    q.set('resultsPerPage', '100');
    if (params.minSqft != null) q.set('minSqft', String(params.minSqft));
    if (params.maxSqft != null) q.set('maxSqft', String(params.maxSqft));
    for (const t of params.propertyTypes ?? []) q.append('propertyType', t);
    if (this.cfg.boardId != null) q.set('boardId', String(this.cfg.boardId));

    const body = await this.get<RepliersListingsResponse>('/listings', q);
    return (body.listings ?? []).map(normalizeRepliersListing);
  }

  async fetchEstimate(params: EstimateParams): Promise<AvmEstimate | null> {
    // CONFIRM(sandbox): exact /estimates request body. Repliers values an
    // off-market property from supplied attributes (address, lot, taxes,
    // details, overallQuality). We pass through `attributes` plus address/geo.
    const payload: Record<string, unknown> = {
      ...(params.attributes ?? {}),
      ...(params.address ? { address: params.address } : {}),
      ...(params.lat != null && params.lng != null
        ? { map: { latitude: params.lat, longitude: params.lng } }
        : {}),
      ...(this.cfg.boardId != null ? { boardId: this.cfg.boardId } : {}),
    };
    const raw = await this.post<Record<string, unknown>>('/estimates', payload);
    const value = numOf(raw['estimate']) ?? numOf(raw['value']);
    if (value == null) return null;
    return {
      value,
      low: numOf(raw['estimateLow']) ?? numOf(raw['low']),
      high: numOf(raw['estimateHigh']) ?? numOf(raw['high']),
      confidence: numOf(raw['confidence']),
      asOf: typeof raw['updatedOn'] === 'string' ? (raw['updatedOn'] as string) : undefined,
      raw,
    };
  }

  // ---- HTTP plumbing -------------------------------------------------------

  private headers(): Record<string, string> {
    return {
      'REPLIERS-API-KEY': this.cfg.apiKey,
      'content-type': 'application/json',
      accept: 'application/json',
    };
  }

  private async get<T>(path: string, params?: URLSearchParams, signal?: AbortSignal): Promise<T> {
    const qs = params && [...params.keys()].length ? `?${params.toString()}` : '';
    const res = await this.fetchImpl(`${this.baseUrl}${path}${qs}`, {
      method: 'GET',
      headers: this.headers(),
      signal,
    });
    return this.parse<T>(res);
  }

  private async post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal,
    });
    return this.parse<T>(res);
  }

  private async parse<T>(res: Response): Promise<T> {
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new RepliersHttpError(res.status, text);
    }
    return (await res.json()) as T;
  }
}

export class RepliersHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Repliers HTTP ${status}: ${body.slice(0, 300)}`);
    this.name = 'RepliersHttpError';
  }
}

function monthsAgoIso(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function numOf(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}
