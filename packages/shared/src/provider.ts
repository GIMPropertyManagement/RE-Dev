import type { MlsListing, PropertyType } from './reso.js';

/**
 * The vendor-agnostic seam. The rest of the app depends ONLY on this interface,
 * never on a concrete vendor. RepliersProvider is the Phase-1 implementation;
 * a SimplyRETS/Bridge/direct-RESO provider can be swapped in by implementing
 * this one interface (the "swap is one file" requirement).
 */
export interface MlsProvider {
  readonly name: string;

  /**
   * Incremental pull of everything created/changed since `since`, ordered by
   * ModificationTimestamp ascending. Uses the RESO ModificationTimestamp
   * watermark — never full-scans daily. Async-iterable so the caller can stream
   * pages and advance the watermark as it goes.
   */
  fetchChangedSince(
    since: string | null,
    opts?: FetchChangedOpts,
  ): AsyncIterable<MlsListing>;

  /** Fetch a single listing by RESO ListingKey (null if not found). */
  fetchById(listingKey: string): Promise<MlsListing | null>;

  /** Sold comparables near a point, for CMA. */
  fetchSoldComps(params: SoldCompsParams): Promise<MlsListing[]>;

  /**
   * Vendor AVM/estimate for an address/parcel, used as a CMA cross-check only
   * (never overrides comp-derived ARV; the engine flags material divergence).
   * Optional because not every provider offers it.
   */
  fetchEstimate?(params: EstimateParams): Promise<AvmEstimate | null>;
}

export interface FetchChangedOpts {
  /** RESO PropertyType filter; omit to ingest ALL types (the default). */
  propertyTypes?: PropertyType[];
  /** Page size hint. */
  pageSize?: number;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
}

export interface SoldCompsParams {
  lat: number;
  lng: number;
  radiusMi: number;
  minSqft?: number;
  maxSqft?: number;
  soldSinceMonths: number;
  propertyTypes?: PropertyType[];
}

/**
 * AVM estimate inputs. The Repliers /estimates endpoint values a *built* home
 * from its attributes (not a raw-land lookup), so the address is structured and
 * `details` describes the dwelling. For our land-build use we pass the PLANNED
 * product's specs to cross-check the comp-derived ARV.
 */
export interface EstimateAddress {
  streetNumber?: string;
  streetName?: string;
  city?: string;
  zip?: string;
  unitNumber?: string;
}
export interface EstimateDetails {
  numBedrooms?: number;
  numBathrooms?: number;
  propertyType?: string;
  sqft?: number;
  style?: string;
}
export interface EstimateParams {
  address?: EstimateAddress;
  details?: EstimateDetails;
  /** 1.0–6.0 or "poor".."excellent" (defaults to "average"). */
  overallQuality?: number | string;
  lotAcres?: number;
  boardId?: number;
}

export interface AvmEstimate {
  value: number;
  low?: number;
  high?: number;
  confidence?: number;
  asOf?: string;
  raw: unknown;
}
