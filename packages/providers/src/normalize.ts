import type { MlsListing, PropertyType, StandardStatus } from '@forge/shared';

/**
 * Repliers -> RESO normalization.
 *
 * The Repliers `/listings` payload is shaped around board/RESO data but uses its
 * own field names and compact status codes. We map the subset the feasibility
 * pipeline needs into RESO Data Dictionary field names and keep the full raw
 * object on `raw`.
 *
 * NOTE: the exact Repliers response schema is gated behind their docs' "Try It",
 * so this normalizer is intentionally defensive (every field optional, unknown
 * codes fall through to sensible defaults). Once a sandbox key is in hand,
 * exercise the live shape and tighten `RepliersRawListing` + the status/type
 * maps below. The behavior is locked by test/normalize.test.ts.
 */

/** Loose model of a Repliers listing — only fields we read are typed. */
export interface RepliersRawListing {
  mlsNumber?: string;
  /** Compact current status: 'A' (active) | 'U' (unavailable/closed-ish). */
  status?: string;
  /** Compact last-status code that disambiguates 'U' (e.g. 'Sld', 'Exp'). */
  lastStatus?: string;
  listPrice?: number | string;
  originalPrice?: number | string;
  soldPrice?: number | string;
  listDate?: string;
  soldDate?: string;
  updatedOn?: string;
  timestamps?: { listingUpdated?: string; conversionTimestamp?: string };
  daysOnMarket?: number | string;
  /** 'Sale' | 'Lease' */
  type?: string;
  /** 'residential' | 'condo' | 'commercial' (board class). */
  class?: string;
  address?: {
    streetNumber?: string | number;
    streetName?: string;
    streetSuffix?: string;
    unitNumber?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
    neighborhood?: string;
    majorIntersection?: string;
  };
  map?: { latitude?: number | string; longitude?: number | string };
  lot?: {
    acres?: number | string;
    squareFeet?: number | string;
    size?: string;
    legalDescription?: string;
  };
  details?: {
    propertyType?: string;
    style?: string;
    sqft?: number | string;
    yearBuilt?: number | string;
    numBedrooms?: number | string;
    description?: string;
    zoning?: string;
  };
  /** APN if the board provides it. */
  pin?: string;
  parcelNumber?: string;
  /** Display opt-out flags if present. */
  permissions?: {
    displayInternetEntireListing?: boolean;
    displayAddressOnInternet?: boolean;
  };
  [k: string]: unknown;
}

/** Repliers compact lastStatus codes -> RESO StandardStatus (best-effort). */
const LAST_STATUS_MAP: Record<string, StandardStatus> = {
  New: 'Active',
  Pc: 'Active', // price change, still active
  Ext: 'Active', // extended
  Dft: 'Active', // deal fell through -> back active
  Sc: 'ActiveUnderContract', // sold conditional
  Sce: 'ActiveUnderContract', // sold conditional w/ escape
  Lc: 'ActiveUnderContract', // leased conditional
  Sld: 'Closed', // sold
  Lsd: 'Closed', // leased
  Exp: 'Expired',
  Ter: 'Canceled', // terminated
  Sus: 'Hold', // suspended
};
// (Confirmed lastStatus set: New, Pc, Ext, Dft, Sc, Sce, Lc, Sld, Lsd, Exp, Ter, Sus.)

function statusOf(r: RepliersRawListing): StandardStatus {
  if (r.lastStatus && LAST_STATUS_MAP[r.lastStatus]) {
    return LAST_STATUS_MAP[r.lastStatus];
  }
  if (r.status === 'A') return 'Active';
  if (r.status === 'U') return r.soldPrice != null ? 'Closed' : 'Unknown';
  return 'Unknown';
}

function propertyTypeOf(r: RepliersRawListing): PropertyType {
  const cls = (r.class ?? '').toLowerCase();
  const isLease = (r.type ?? '').toLowerCase() === 'lease';
  const detail = `${r.details?.propertyType ?? ''} ${r.details?.style ?? ''}`.toLowerCase();

  if (/\b(vacant\s*land|land|lot|acreage)\b/.test(detail)) return 'Land';
  if (/\bfarm\b/.test(detail)) return 'Farm';
  if (cls.includes('commercial')) return isLease ? 'CommercialLease' : 'CommercialSale';
  if (cls.includes('condo')) return isLease ? 'ResidentialLease' : 'Residential';
  if (cls.includes('residential')) {
    if (isLease) return 'ResidentialLease';
    // Multi-unit hint -> income property
    if (/\b(2|3|4|two|three|four)\s*(family|unit)/.test(detail)) return 'ResidentialIncome';
    return 'Residential';
  }
  return 'Unknown';
}

function num(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s;
}

function modificationTs(r: RepliersRawListing): string {
  return (
    str(r.updatedOn) ??
    str(r.timestamps?.listingUpdated) ??
    str(r.timestamps?.conversionTimestamp) ??
    str(r.soldDate) ??
    str(r.listDate) ??
    new Date(0).toISOString()
  );
}

function unparsedAddress(a: RepliersRawListing['address']): string | undefined {
  if (!a) return undefined;
  const line = [a.streetNumber, a.streetName, a.streetSuffix].filter(Boolean).join(' ').trim();
  const unit = a.unitNumber ? `#${a.unitNumber}` : '';
  const tail = [a.city, a.state, a.zip].filter(Boolean).join(', ');
  return [line, unit, tail].filter(Boolean).join(' ').replace(/\s+,/g, ',').trim() || undefined;
}

export function normalizeRepliersListing(raw: RepliersRawListing): MlsListing {
  const lotAcres = num(raw.lot?.acres);
  const lotSqft = num(raw.lot?.squareFeet) ?? (lotAcres != null ? Math.round(lotAcres * 43560) : undefined);

  return {
    listingKey: str(raw.mlsNumber) ?? `repliers:unknown:${modificationTs(raw)}`,
    listingId: str(raw.mlsNumber),

    standardStatus: statusOf(raw),
    mlsStatus: str(raw.lastStatus) ?? str(raw.status),

    propertyType: propertyTypeOf(raw),
    propertySubType: str(raw.details?.propertyType) ?? str(raw.details?.style),

    listPrice: num(raw.listPrice),
    originalListPrice: num(raw.originalPrice),
    closePrice: num(raw.soldPrice),

    listingContractDate: str(raw.listDate),
    closeDate: str(raw.soldDate),
    daysOnMarket: num(raw.daysOnMarket),

    modificationTimestamp: modificationTs(raw),

    unparsedAddress: unparsedAddress(raw.address),
    streetNumber: str(raw.address?.streetNumber),
    streetName: [str(raw.address?.streetName), str(raw.address?.streetSuffix)]
      .filter(Boolean)
      .join(' ') || undefined,
    city: str(raw.address?.city),
    stateOrProvince: str(raw.address?.state),
    postalCode: str(raw.address?.zip),

    latitude: num(raw.map?.latitude),
    longitude: num(raw.map?.longitude),

    lotSizeAcres: lotAcres,
    lotSizeSquareFeet: lotSqft,
    zoning: str(raw.details?.zoning),
    parcelNumber: str(raw.pin) ?? str(raw.parcelNumber),

    livingArea: num(raw.details?.sqft),
    yearBuilt: num(raw.details?.yearBuilt),

    publicRemarks: str(raw.details?.description),

    internetEntireListingDisplayYN: raw.permissions?.displayInternetEntireListing,
    internetAddressDisplayYN: raw.permissions?.displayAddressOnInternet,

    raw,
  };
}
