/** Internal domain model (DB-backed entities). */

import type { SourceRef } from './reso.js';

/**
 * A physical parcel — the stable unit we cache research against.
 *
 * The cache key is the authoritative MassGIS L3 parcel id (`locId`), NOT the
 * listing address. MLS listings frequently lack an APN and raw land often has
 * no street address ("Lot 4 Russo Dr"), so address-keying both splits one
 * parcel's research across duplicate rows and merges unrelated parcels. We
 * resolve every listing to a parcel spatially (geocode -> point-in-polygon
 * against MassGIS L3). Listings that don't resolve to exactly one parcel get
 * `resolution = 'unresolved'` and are held for human review.
 */
export interface Parcel {
  id: string; // uuid
  /** MassGIS L3 LOC_ID — the authoritative parcel key (preferred). */
  locId: string | null;
  /** Assessor parcel number (MAP_PAR_ID / APN) once resolved. */
  apn: string | null;
  resolution: ParcelResolution;

  address: string | null;
  city: string | null;
  state: string; // 'MA'
  zip: string | null;

  lotAcres: number | null;
  lotSqft: number | null;
  zoningCode: string | null;
  zoningSource: string | null;

  createdAt: string;
  updatedAt: string;
}

export type ParcelResolution =
  | 'l3' // resolved to exactly one MassGIS L3 parcel (best)
  | 'address' // fallback: matched on normalized address only
  | 'unresolved'; // could not map to exactly one parcel -> needs human review

export type ListingStatusChange = 'new' | 'price' | 'status' | 'unchanged';

/** Research kinds cached per parcel (research_cache.kind). */
export type ResearchKind =
  | 'zoning'
  | 'topo'
  | 'flood'
  | 'wetlands'
  | 'ownership'
  | 'cma'
  | 'feasibility';

export type Confidence = 'high' | 'medium' | 'low';

/** Default cache TTLs in days, by research kind. */
export const RESEARCH_TTL_DAYS: Record<ResearchKind, number> = {
  zoning: 180,
  topo: 180,
  flood: 180,
  wetlands: 180,
  ownership: 180,
  cma: 21,
  // feasibility/pro forma is recomputed whenever inputs or comps change, not on a clock.
  feasibility: 0,
};

export interface ResearchCacheRecord<TPayload = unknown> {
  id: string;
  parcelId: string;
  kind: ResearchKind;
  payload: TPayload;
  sources: SourceRef[];
  confidence: Confidence;
  /** True when a primary/government source could not confirm a figure — held for human review. */
  needsHuman: boolean;
  needsHumanReasons: NeedsHumanReason[];
  generatedAt: string;
  staleAfter: string | null;
}

export type NeedsHumanReason =
  | 'no_source_found'
  | 'sources_conflict'
  | 'url_unverifiable'
  | 'low_confidence_financial'
  | 'parcel_unresolved'
  | 'budget_exceeded'
  | 'screening_only' // e.g. a 2005-vintage wetlands hit needs professional delineation
  | 'data_unavailable';

export interface RiskFlag {
  code:
    | 'ledge_risk'
    | 'frontage_variance'
    | 'wetlands'
    | 'flood_zone'
    | 'easement'
    | 'fill_required'
    | 'steep_slope'
    | 'thin_comps'
    | 'over_cash_cap'
    | 'low_data_confidence';
  detail?: string;
}

export interface SyncState {
  provider: string;
  lastModificationTs: string | null;
}
