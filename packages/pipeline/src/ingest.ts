import type { MlsProvider } from '@forge/shared';
import {
  Db,
  getSyncState,
  setSyncState,
  upsertListing,
  upsertResolvedParcel,
} from '@forge/db';
import { resolveParcel } from '@forge/gis';

export interface IngestResult {
  provider: string;
  ingested: number;
  resolved: number;
  unresolved: number;
  fromWatermark: string | null;
  toWatermark: string | null;
}

/**
 * One incremental ingest pass:
 *   1. read the provider's last ModificationTimestamp watermark
 *   2. stream everything changed since (all MA property types)
 *   3. resolve each listing to a stable MassGIS L3 parcel (geocode -> PIP)
 *   4. upsert parcel (on loc_id) + listing (on mls_listing_key) — idempotent
 *   5. advance the watermark to the newest timestamp seen
 *
 * Per-listing failures isolate and log; they don't abort the run. Listings that
 * don't resolve to exactly one parcel are stored with parcel_id = NULL and left
 * for human review (we never guess a parcel identity).
 */
export async function runIngest(
  db: Db,
  provider: MlsProvider,
  log: (msg: string, extra?: Record<string, unknown>) => void = () => {},
): Promise<IngestResult> {
  const since = await getSyncState(db, provider.name);
  let watermark = since;
  let ingested = 0;
  let resolved = 0;
  let unresolved = 0;
  // Dedupe within a run: a provider can emit the same ListingKey twice across
  // pages; the DB upsert is idempotent anyway, but skipping avoids wasted
  // parcel-resolution work and double counts.
  const seen = new Set<string>();

  for await (const listing of provider.fetchChangedSince(since)) {
    if (seen.has(listing.listingKey)) continue;
    seen.add(listing.listingKey);
    try {
      let parcelId: string | null = null;

      // Resolve only MA parcels (the analyzer is MA-only in v1).
      const isMa = !listing.stateOrProvince || listing.stateOrProvince.toUpperCase() === 'MA';
      if (isMa) {
        const r = await resolveParcel({
          lat: listing.latitude,
          lng: listing.longitude,
          address: listing.unparsedAddress,
        });
        if (r.resolution === 'l3' && r.locId) {
          parcelId = await upsertResolvedParcel(db, {
            locId: r.locId,
            apn: r.apn,
            address: listing.unparsedAddress ?? r.attributes?.SITE_ADDR ?? null,
            city: listing.city ?? null,
            zip: listing.postalCode ?? null,
            lat: r.point?.lat ?? null,
            lng: r.point?.lng ?? null,
            lotAcres:
              listing.lotSizeAcres ?? r.attributes?.LOT_SIZE ?? null,
            zoning: listing.zoning ?? r.attributes?.ZONING ?? null,
          });
        }
      }

      await upsertListing(db, listing, parcelId);
      ingested += 1;
      if (parcelId) resolved += 1;
      else unresolved += 1;

      if (!watermark || listing.modificationTimestamp > watermark) {
        watermark = listing.modificationTimestamp;
      }
    } catch (err) {
      // Isolate per-listing failures — log and continue.
      log('ingest_listing_failed', {
        listingKey: listing.listingKey,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (watermark && watermark !== since) {
    await setSyncState(db, provider.name, watermark);
  }

  return {
    provider: provider.name,
    ingested,
    resolved,
    unresolved,
    fromWatermark: since,
    toWatermark: watermark,
  };
}
