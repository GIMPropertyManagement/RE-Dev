/**
 * RESO Data Dictionary-normalized listing model.
 *
 * This is the internal canonical shape. Every MlsProvider normalizes its
 * vendor-specific payload INTO these field names so the rest of the app never
 * knows which vendor (Repliers today, SimplyRETS/Bridge/direct-RESO later) is
 * behind it.
 *
 * IMPORTANT (verified 2026-06): MLS PIN currently certifies on RESO Data
 * Dictionary **1.7**, while the published RESO standard is 2.x. We target the
 * RESO field names as the canonical model but anchor enum/field expectations to
 * what MLS PIN actually serves (1.7). Keep all vendor/version mapping inside the
 * provider adapter (see normalize.ts) so a future MLS PIN move to DD 2.x is a
 * localized change, not a refactor.
 */

export const RESO_DATA_DICTIONARY_VERSION = '1.7' as const;

/** RESO StandardStatus enum (DD 1.7). */
export type StandardStatus =
  | 'Active'
  | 'ActiveUnderContract'
  | 'Pending'
  | 'Closed'
  | 'Expired'
  | 'Canceled'
  | 'Withdrawn'
  | 'ComingSoon'
  | 'Hold'
  | 'Delete'
  | 'Incomplete'
  | 'Unknown';

/**
 * RESO PropertyType (DD 1.7). We ingest ALL types statewide and filter in-app;
 * land-first but everything is captured.
 */
export type PropertyType =
  | 'Residential'
  | 'ResidentialIncome'
  | 'ResidentialLease'
  | 'Land'
  | 'Farm'
  | 'CommercialSale'
  | 'CommercialLease'
  | 'BusinessOpportunity'
  | 'ManufacturedInPark'
  | 'Unknown';

/** A source citation kept alongside any derived/looked-up value. */
export interface SourceRef {
  title: string;
  /** Must be a real URL actually fetched/seen this turn (validated server-side). */
  url: string;
  publisher?: string;
  retrievedAt?: string;
}

/**
 * The normalized listing. Only a pragmatic subset of the ~300 RESO fields is
 * typed here — the ones the feasibility pipeline actually reads. The complete
 * vendor payload is preserved verbatim in `raw` so we can re-parse without
 * re-fetching (and so we never lose a field we didn't think to type yet).
 */
export interface MlsListing {
  /** RESO ListingKey — the stable per-listing identifier. */
  listingKey: string;
  /** Human-facing MLS number (ListingId). */
  listingId?: string;

  standardStatus: StandardStatus;
  /** Vendor/board raw status string, kept for fidelity (RESO MlsStatus). */
  mlsStatus?: string;

  propertyType: PropertyType;
  propertySubType?: string;

  listPrice?: number;
  originalListPrice?: number;
  closePrice?: number;

  listingContractDate?: string; // ISO date
  closeDate?: string; // ISO date
  daysOnMarket?: number;

  /** RESO ModificationTimestamp — the incremental-sync high-water mark. */
  modificationTimestamp: string; // ISO datetime

  // Address
  unparsedAddress?: string;
  streetNumber?: string;
  streetName?: string;
  city?: string;
  stateOrProvince?: string;
  postalCode?: string;
  countyOrParish?: string;

  // Geo
  latitude?: number;
  longitude?: number;

  // Land / lot — load-bearing for feasibility; confirm populated in MLS PIN 1.7
  lotSizeAcres?: number;
  lotSizeSquareFeet?: number;
  zoning?: string;
  /** RESO ParcelNumber (APN). Often absent on MLS listings — do NOT rely on it
   *  as the parcel key; we resolve parcels spatially against MassGIS L3. */
  parcelNumber?: string;

  livingArea?: number;
  yearBuilt?: number;

  publicRemarks?: string;

  /**
   * RESO IDX/public-display opt-out flags. These govern PUBLIC display, not
   * internal back-office analysis, but we honor them conservatively. See
   * compliance notes in ARCHITECTURE.md.
   */
  internetEntireListingDisplayYN?: boolean;
  internetAddressDisplayYN?: boolean;

  /** Full vendor payload, stored verbatim (-> listings.raw JSONB). */
  raw: unknown;
}
