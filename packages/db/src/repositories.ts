import type { MlsListing } from '@forge/shared';
import type { Db, ParamValue } from './client.js';

/** Filters accepted by the dashboard parcel list. */
export interface ParcelFilters {
  city?: string;
  propertyType?: string;
  minPrice?: number;
  maxPrice?: number;
  minLotAcres?: number;
  minScore?: number;
  limit?: number;
  offset?: number;
}

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

/**
 * Dashboard list. Phase 1 is listing-centric (goal: "every MA listing in our DB
 * daily"); scores join in once Phase 3 lands. Latest score per parcel wins.
 */
export async function listParcels(db: Db, f: ParcelFilters): Promise<ParcelRow[]> {
  const where: string[] = [];
  const params: Record<string, ParamValue> = {};

  if (f.city) {
    where.push('lower(coalesce(p.city, l_city.city)) = lower(:city)');
    params.city = f.city;
  }
  if (f.propertyType) {
    where.push('l.property_type = :propertyType');
    params.propertyType = f.propertyType;
  }
  if (f.minPrice != null) {
    where.push('l.list_price >= :minPrice');
    params.minPrice = f.minPrice;
  }
  if (f.maxPrice != null) {
    where.push('l.list_price <= :maxPrice');
    params.maxPrice = f.maxPrice;
  }
  if (f.minLotAcres != null) {
    where.push('coalesce(p.lot_acres, l.lot_acres) >= :minLotAcres');
    params.minLotAcres = f.minLotAcres;
  }
  if (f.minScore != null) {
    where.push('s.score >= :minScore');
    params.minScore = f.minScore;
  }

  const limit = clamp(f.limit ?? 100, 1, 500);
  const offset = Math.max(0, f.offset ?? 0);
  params.limit = limit;
  params.offset = offset;

  const sql = `
    SELECT
      p.id              AS parcel_id,
      p.loc_id          AS loc_id,
      coalesce(p.resolution::text, 'unresolved') AS resolution,
      coalesce(p.address, '')  AS address,
      p.city            AS city,
      p.zip             AS zip,
      l.mls_listing_key AS mls_listing_key,
      l.standard_status AS standard_status,
      l.property_type   AS property_type,
      l.list_price      AS list_price,
      coalesce(p.lot_acres, l.lot_acres) AS lot_acres,
      l.modification_ts AS modification_ts,
      s.score           AS score,
      s.rank            AS rank,
      s.profit_mid      AS profit_mid,
      coalesce(s.flags, '[]'::jsonb) AS flags,
      s.summary         AS summary
    FROM listings l
    LEFT JOIN parcels p ON p.id = l.parcel_id
    LEFT JOIN LATERAL (SELECT NULL::text AS city) l_city ON true
    LEFT JOIN LATERAL (
      SELECT score, rank, profit_mid, flags, summary
      FROM scores sc
      WHERE sc.parcel_id = p.id
      ORDER BY sc.run_date DESC
      LIMIT 1
    ) s ON true
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY s.score DESC NULLS LAST, l.modification_ts DESC
    LIMIT :limit OFFSET :offset
  `;
  return db.query<ParcelRow>(sql, params);
}

/** Advance/read the incremental sync watermark for a provider. */
export async function getSyncState(db: Db, provider: string): Promise<string | null> {
  const rows = await db.query<{ last_modification_ts: string | null }>(
    'SELECT last_modification_ts FROM sync_state WHERE provider = :provider',
    { provider },
  );
  return rows[0]?.last_modification_ts ?? null;
}

export async function setSyncState(db: Db, provider: string, ts: string): Promise<void> {
  await db.execute(
    `INSERT INTO sync_state (provider, last_modification_ts, updated_at)
     VALUES (:provider, :ts::timestamptz, now())
     ON CONFLICT (provider)
     DO UPDATE SET last_modification_ts = EXCLUDED.last_modification_ts, updated_at = now()`,
    { provider, ts },
  );
}

/** Upsert a listing on its natural key (idempotent — re-running a day is safe). */
export async function upsertListing(
  db: Db,
  listing: MlsListing,
  parcelId: string | null,
): Promise<void> {
  await db.execute(
    `INSERT INTO listings (
        parcel_id, mls_listing_key, mls_listing_id, standard_status, mls_status,
        property_type, property_subtype, list_price, original_list_price, close_price,
        dom, list_date, close_date, modification_ts, lot_acres, lot_sqft,
        latitude, longitude, raw, first_seen_at, last_seen_at
     ) VALUES (
        :parcelId, :key, :id, :status, :mlsStatus,
        :ptype, :psubtype, :listPrice, :origPrice, :closePrice,
        :dom, :listDate::date, :closeDate::date, :modTs::timestamptz, :lotAcres, :lotSqft,
        :lat, :lng, :raw::jsonb, now(), now()
     )
     ON CONFLICT (mls_listing_key) DO UPDATE SET
        parcel_id = EXCLUDED.parcel_id,
        standard_status = EXCLUDED.standard_status,
        mls_status = EXCLUDED.mls_status,
        list_price = EXCLUDED.list_price,
        close_price = EXCLUDED.close_price,
        dom = EXCLUDED.dom,
        close_date = EXCLUDED.close_date,
        modification_ts = EXCLUDED.modification_ts,
        raw = EXCLUDED.raw,
        last_seen_at = now()`,
    {
      parcelId,
      key: listing.listingKey,
      id: nullable(listing.listingId),
      status: listing.standardStatus,
      mlsStatus: nullable(listing.mlsStatus),
      ptype: nullable(listing.propertyType),
      psubtype: nullable(listing.propertySubType),
      listPrice: nullableNum(listing.listPrice),
      origPrice: nullableNum(listing.originalListPrice),
      closePrice: nullableNum(listing.closePrice),
      dom: nullableNum(listing.daysOnMarket),
      listDate: nullable(listing.listingContractDate),
      closeDate: nullable(listing.closeDate),
      modTs: listing.modificationTimestamp,
      lotAcres: nullableNum(listing.lotSizeAcres),
      lotSqft: nullableNum(listing.lotSizeSquareFeet),
      lat: nullableNum(listing.latitude),
      lng: nullableNum(listing.longitude),
      raw: JSON.stringify(listing.raw),
    },
  );
}

/**
 * Upsert a parcel from an L3 resolution, returning its id. Keyed on loc_id so a
 * second listing for the same parcel attaches to the same row (the heart of the
 * "never re-research" cache). Returns null for unresolved listings.
 */
export async function upsertResolvedParcel(
  db: Db,
  p: {
    locId: string;
    apn: string | null;
    address: string | null;
    city: string | null;
    zip: string | null;
    lat: number | null;
    lng: number | null;
    lotAcres: number | null;
    zoning: string | null;
  },
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `INSERT INTO parcels (
        loc_id, apn, resolution, address, city, state, zip,
        geom, lot_acres, zoning_code, zoning_source, updated_at
     ) VALUES (
        :locId, :apn, 'l3', :address, :city, 'MA', :zip,
        CASE WHEN :lng IS NULL THEN NULL
             ELSE ST_SetSRID(ST_MakePoint(:lng, :lat), 4326) END,
        :lotAcres, :zoning, 'massgis_l3', now()
     )
     ON CONFLICT (loc_id) WHERE loc_id IS NOT NULL
     DO UPDATE SET
        apn = EXCLUDED.apn,
        address = coalesce(parcels.address, EXCLUDED.address),
        lot_acres = coalesce(EXCLUDED.lot_acres, parcels.lot_acres),
        zoning_code = coalesce(EXCLUDED.zoning_code, parcels.zoning_code),
        updated_at = now()
     RETURNING id`,
    {
      locId: p.locId,
      apn: p.apn,
      address: p.address,
      city: p.city,
      zip: p.zip,
      lat: nullableNum(p.lat),
      lng: nullableNum(p.lng),
      lotAcres: nullableNum(p.lotAcres),
      zoning: p.zoning,
    },
  );
  return rows[0].id;
}

// ---- research_cache --------------------------------------------------------

export interface ResearchRow {
  kind: string;
  payload: unknown;
  sources: unknown;
  confidence: string;
  needs_human: boolean;
  needs_human_reasons: string[];
  generated_at: string;
  stale_after: string | null;
}

export async function getResearch(
  db: Db,
  parcelId: string,
  kind: string,
): Promise<ResearchRow | null> {
  const rows = await db.query<ResearchRow>(
    `SELECT kind::text AS kind, payload, sources, confidence::text AS confidence,
            needs_human, needs_human_reasons, generated_at, stale_after
     FROM research_cache WHERE parcel_id = :parcelId AND kind = :kind::research_kind`,
    { parcelId, kind },
  );
  return rows[0] ?? null;
}

export interface ResearchUpsert {
  kind: string;
  payload: unknown;
  sources: unknown;
  confidence: string;
  needsHuman: boolean;
  needsHumanReasons: string[];
  staleAfter: string | null;
}

export async function upsertResearch(
  db: Db,
  parcelId: string,
  r: ResearchUpsert,
): Promise<void> {
  await db.execute(
    `INSERT INTO research_cache (
        parcel_id, kind, payload, sources, confidence, needs_human,
        needs_human_reasons, generated_at, stale_after
     ) VALUES (
        :parcelId, :kind::research_kind, :payload::jsonb, :sources::jsonb,
        :confidence::confidence, :needsHuman, :reasons::text[], now(), :staleAfter::timestamptz
     )
     ON CONFLICT (parcel_id, kind) DO UPDATE SET
        payload = EXCLUDED.payload,
        sources = EXCLUDED.sources,
        confidence = EXCLUDED.confidence,
        needs_human = EXCLUDED.needs_human,
        needs_human_reasons = EXCLUDED.needs_human_reasons,
        generated_at = now(),
        stale_after = EXCLUDED.stale_after`,
    {
      parcelId,
      kind: r.kind,
      payload: JSON.stringify(r.payload),
      sources: JSON.stringify(r.sources),
      confidence: r.confidence,
      needsHuman: r.needsHuman,
      reasons: toPgTextArray(r.needsHumanReasons),
      staleAfter: r.staleAfter,
    },
  );
}

/** Serialize a string[] to a Postgres array literal (Data API has no array param). */
function toPgTextArray(items: string[]): string {
  if (!items.length) return '{}';
  return `{${items.map((s) => `"${s.replace(/"/g, '\\"')}"`).join(',')}}`;
}

// ---- pro_formas / scores / ranking (Phase 3) -------------------------------

export interface ProFormaUpsert {
  scenario: string; // 'auto' | 'user:<sub>:<name>'
  inputs: unknown;
  arvLow: number | null;
  arvHigh: number | null;
  allinLow: number | null;
  allinHigh: number | null;
  profitLow: number | null;
  profitHigh: number | null;
  createdBy: string | null;
}

export async function upsertProForma(db: Db, parcelId: string, pf: ProFormaUpsert): Promise<void> {
  await db.execute(
    `INSERT INTO pro_formas (
        parcel_id, scenario, inputs, arv_low, arv_high, allin_low, allin_high,
        profit_low, profit_high, created_by, created_at
     ) VALUES (
        :parcelId, :scenario, :inputs::jsonb, :arvLow, :arvHigh, :allinLow, :allinHigh,
        :profitLow, :profitHigh, :createdBy, now()
     )
     ON CONFLICT (parcel_id, scenario) DO UPDATE SET
        inputs = EXCLUDED.inputs,
        arv_low = EXCLUDED.arv_low, arv_high = EXCLUDED.arv_high,
        allin_low = EXCLUDED.allin_low, allin_high = EXCLUDED.allin_high,
        profit_low = EXCLUDED.profit_low, profit_high = EXCLUDED.profit_high,
        created_at = now()`,
    {
      parcelId,
      scenario: pf.scenario,
      inputs: JSON.stringify(pf.inputs),
      arvLow: nullableNum(pf.arvLow),
      arvHigh: nullableNum(pf.arvHigh),
      allinLow: nullableNum(pf.allinLow),
      allinHigh: nullableNum(pf.allinHigh),
      profitLow: nullableNum(pf.profitLow),
      profitHigh: nullableNum(pf.profitHigh),
      createdBy: pf.createdBy,
    },
  );
}

export interface ScoreUpsert {
  runDate: string; // YYYY-MM-DD
  score: number;
  profitMid: number | null;
  flags: unknown;
  summary: string | null;
}

export async function upsertScore(db: Db, parcelId: string, s: ScoreUpsert): Promise<void> {
  await db.execute(
    `INSERT INTO scores (parcel_id, run_date, score, profit_mid, flags, summary, created_at)
     VALUES (:parcelId, :runDate::date, :score, :profitMid, :flags::jsonb, :summary, now())
     ON CONFLICT (parcel_id, run_date) DO UPDATE SET
        score = EXCLUDED.score, profit_mid = EXCLUDED.profit_mid,
        flags = EXCLUDED.flags, summary = EXCLUDED.summary, created_at = now()`,
    {
      parcelId,
      runDate: s.runDate,
      score: s.score,
      profitMid: nullableNum(s.profitMid),
      flags: JSON.stringify(s.flags),
      summary: s.summary,
    },
  );
}

/** Assign dense ranks within a run_date, best score first. */
export async function rankRun(db: Db, runDate: string): Promise<void> {
  await db.execute(
    `UPDATE scores s SET rank = r.rn
     FROM (
       SELECT id, row_number() OVER (ORDER BY score DESC, profit_mid DESC NULLS LAST) AS rn
       FROM scores WHERE run_date = :runDate::date
     ) r
     WHERE s.id = r.id`,
    { runDate },
  );
}

// ---- enrich selection ------------------------------------------------------

export interface EnrichCandidate {
  parcel_id: string;
  lat: number | null;
  lng: number | null;
  address: string | null;
  city: string | null;
  lot_acres: number | null;
  zoning_code: string | null;
  list_price: number | null;
  original_list_price: number | null;
  dom: number | null;
  standard_status: string | null;
}

/** Resolved parcels not yet scored for runDate (or whose listing changed since). */
export async function selectParcelsToEnrich(
  db: Db,
  runDate: string,
  limit = 200,
): Promise<EnrichCandidate[]> {
  return db.query<EnrichCandidate>(
    `SELECT p.id AS parcel_id,
            ST_Y(p.geom) AS lat, ST_X(p.geom) AS lng,
            p.address, p.city, p.lot_acres, p.zoning_code,
            l.list_price, l.original_list_price, l.dom, l.standard_status
     FROM parcels p
     JOIN LATERAL (
       SELECT list_price, original_list_price, dom, standard_status, modification_ts
       FROM listings l WHERE l.parcel_id = p.id
       ORDER BY modification_ts DESC LIMIT 1
     ) l ON true
     LEFT JOIN LATERAL (
       SELECT max(run_date) AS rd FROM scores s WHERE s.parcel_id = p.id
     ) sc ON true
     WHERE p.resolution = 'l3'
       AND (sc.rd IS NULL OR sc.rd < :runDate::date)
     LIMIT :limit`,
    { runDate, limit },
  );
}

// ---- watchlist / runs / digest --------------------------------------------

export async function ensureAppUser(
  db: Db,
  sub: string,
  email: string | null,
): Promise<void> {
  await db.execute(
    `INSERT INTO app_users (cognito_sub, email) VALUES (:sub, :email)
     ON CONFLICT (cognito_sub) DO UPDATE SET email = coalesce(EXCLUDED.email, app_users.email)`,
    { sub, email },
  );
}

export async function toggleWatch(
  db: Db,
  sub: string,
  parcelId: string,
): Promise<{ watched: boolean }> {
  const existing = await db.query<{ x: number }>(
    'SELECT 1 AS x FROM watchlist WHERE cognito_sub = :sub AND parcel_id = :p',
    { sub, p: parcelId },
  );
  if (existing.length) {
    await db.execute('DELETE FROM watchlist WHERE cognito_sub = :sub AND parcel_id = :p', {
      sub,
      p: parcelId,
    });
    return { watched: false };
  }
  await db.execute(
    'INSERT INTO watchlist (cognito_sub, parcel_id) VALUES (:sub, :p) ON CONFLICT DO NOTHING',
    { sub, p: parcelId },
  );
  return { watched: true };
}

/** Force a re-research: drop the parcel's cached research + today's score so the
 *  next enrich run regenerates everything. */
export async function bustResearch(db: Db, parcelId: string, runDate: string): Promise<void> {
  await db.execute('DELETE FROM research_cache WHERE parcel_id = :p', { p: parcelId });
  await db.execute('DELETE FROM scores WHERE parcel_id = :p AND run_date = :rd::date', {
    p: parcelId,
    rd: runDate,
  });
}

export async function getRun(db: Db, runDate: string): Promise<ParcelRow[]> {
  return db.query<ParcelRow>(
    `SELECT p.id AS parcel_id, p.loc_id, p.resolution::text AS resolution,
            coalesce(p.address,'') AS address, p.city, p.zip,
            l.mls_listing_key, l.standard_status, l.property_type, l.list_price,
            coalesce(p.lot_acres, l.lot_acres) AS lot_acres, l.modification_ts,
            s.score, s.rank, s.profit_mid, coalesce(s.flags,'[]'::jsonb) AS flags, s.summary
     FROM scores s
     JOIN parcels p ON p.id = s.parcel_id
     JOIN LATERAL (
       SELECT mls_listing_key, standard_status, property_type, list_price, lot_acres, modification_ts
       FROM listings l WHERE l.parcel_id = p.id ORDER BY modification_ts DESC LIMIT 1
     ) l ON true
     WHERE s.run_date = :runDate::date
     ORDER BY s.rank ASC NULLS LAST`,
    { runDate },
  );
}

/** Top N for the latest run + watched parcels whose listing changed recently. */
export async function getDigest(
  db: Db,
  sub: string,
  topN = 10,
): Promise<{ top: ParcelRow[]; watchedChanges: ParcelRow[] }> {
  const latest = await db.query<{ rd: string }>(
    'SELECT max(run_date) AS rd FROM scores',
  );
  const runDate = latest[0]?.rd ?? null;
  const top = runDate
    ? (await getRun(db, runDate)).slice(0, topN)
    : [];
  const watchedChanges = await db.query<ParcelRow>(
    `SELECT p.id AS parcel_id, p.loc_id, p.resolution::text AS resolution,
            coalesce(p.address,'') AS address, p.city, p.zip,
            l.mls_listing_key, l.standard_status, l.property_type, l.list_price,
            coalesce(p.lot_acres, l.lot_acres) AS lot_acres, l.modification_ts,
            s.score, s.rank, s.profit_mid, coalesce(s.flags,'[]'::jsonb) AS flags, s.summary
     FROM watchlist w
     JOIN parcels p ON p.id = w.parcel_id
     JOIN LATERAL (
       SELECT mls_listing_key, standard_status, property_type, list_price, lot_acres, modification_ts
       FROM listings l WHERE l.parcel_id = p.id ORDER BY modification_ts DESC LIMIT 1
     ) l ON true
     LEFT JOIN LATERAL (
       SELECT score, rank, profit_mid, flags, summary FROM scores s
       WHERE s.parcel_id = p.id ORDER BY run_date DESC LIMIT 1
     ) s ON true
     WHERE w.cognito_sub = :sub AND l.modification_ts > now() - interval '2 days'
     ORDER BY l.modification_ts DESC`,
    { sub },
  );
  return { top, watchedChanges };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
function nullable(v: string | undefined | null): ParamValue {
  return v == null || v === '' ? null : v;
}
function nullableNum(v: number | undefined | null): ParamValue {
  return v == null || !Number.isFinite(v) ? null : v;
}
