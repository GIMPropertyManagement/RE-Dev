import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import {
  Db,
  bustResearch,
  ensureAppUser,
  getDigest,
  getRun,
  listParcels,
  toggleWatch,
  upsertProForma,
  type ParcelFilters,
} from '@forge/db';
import { computeProForma, DEFAULT_PRO_FORMA_INPUTS, type ProFormaInputs } from '@forge/scoring';
import { buildMemoPdf, detailToMemoData, type ParcelDetail } from '@forge/pdf';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * App API Lambda behind an API Gateway HTTP API with a Cognito JWT authorizer.
 * Runs outside the VPC; reaches Aurora via the RDS Data API. Every request
 * carries verified JWT claims (the gateway rejects unauthenticated callers).
 *
 *   GET  /parcels                 list + filters (paged)
 *   GET  /parcels/{id}            full detail
 *   POST /parcels/{id}/proforma   create/update a user scenario
 *   POST /parcels/{id}/watch      toggle watchlist
 *   POST /parcels/{id}/reresearch force-refresh (bust cache)
 *   GET  /runs/{date}             daily ranking snapshot
 *   GET  /digest/today            top opportunities + watched changes
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  const db = new Db({
    resourceArn: requireEnv('CLUSTER_ARN'),
    secretArn: requireEnv('DB_SECRET_ARN'),
    database: process.env.DB_NAME ?? 'forge',
    region: process.env.AWS_REGION,
  });

  const method = event.requestContext.http.method;
  const path = event.requestContext.http.path;
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const sub = String(claims.sub ?? '');
  const email = claims.email ? String(claims.email) : null;

  try {
    if (method === 'GET' && path === '/parcels') {
      const rows = await listParcels(db, parseFilters(event.queryStringParameters ?? {}));
      return json(200, { parcels: rows, count: rows.length });
    }

    if (method === 'GET' && path === '/digest/today') {
      return json(200, await getDigest(db, sub));
    }

    const run = path.match(/^\/runs\/([0-9]{4}-[0-9]{2}-[0-9]{2})$/);
    if (method === 'GET' && run) {
      const rows = await getRun(db, run[1]);
      return json(200, { run_date: run[1], parcels: rows, count: rows.length });
    }

    const proforma = path.match(/^\/parcels\/([^/]+)\/proforma$/);
    if (method === 'POST' && proforma) {
      return json(200, await saveProForma(db, decodeURIComponent(proforma[1]), sub, parseBody(event)));
    }

    const watch = path.match(/^\/parcels\/([^/]+)\/watch$/);
    if (method === 'POST' && watch) {
      if (!sub) return json(401, { error: 'no_subject' });
      await ensureAppUser(db, sub, email);
      return json(200, await toggleWatch(db, sub, decodeURIComponent(watch[1])));
    }

    const reresearch = path.match(/^\/parcels\/([^/]+)\/reresearch$/);
    if (method === 'POST' && reresearch) {
      const today = new Date().toISOString().slice(0, 10);
      await bustResearch(db, decodeURIComponent(reresearch[1]), today);
      return json(202, { busted: true, note: 'Re-research scheduled on the next enrich run.' });
    }

    const report = path.match(/^\/parcels\/([^/]+)\/report\.pdf$/);
    if (method === 'GET' && report) {
      return json(200, await buildReport(db, decodeURIComponent(report[1])));
    }

    const detail = path.match(/^\/parcels\/([^/]+)$/);
    if (method === 'GET' && detail) {
      return json(200, await getParcelDetail(db, decodeURIComponent(detail[1])));
    }

    return json(404, { error: 'not_found' });
  } catch (err) {
    console.error(JSON.stringify({ msg: 'api_error', error: String(err) }));
    return json(500, { error: 'internal_error' });
  }
}

async function getParcelDetail(db: Db, parcelId: string) {
  const [parcel] = await db.query(
    `SELECT id, loc_id, apn, resolution::text AS resolution, address, city, state, zip,
            lot_acres, lot_sqft, zoning_code, zoning_source,
            ST_Y(geom) AS lat, ST_X(geom) AS lng, ST_AsGeoJSON(lot_geom) AS lot_geojson
     FROM parcels WHERE id = :id`,
    { id: parcelId },
  );
  if (!parcel) return { error: 'not_found' };
  const listings = await db.query(
    `SELECT mls_listing_key, standard_status, property_type, list_price, close_price,
            dom, list_date, close_date, modification_ts
     FROM listings WHERE parcel_id = :id ORDER BY modification_ts DESC`,
    { id: parcelId },
  );
  const research = await db.query(
    `SELECT kind::text AS kind, payload, confidence::text AS confidence, needs_human,
            sources, generated_at, stale_after
     FROM research_cache WHERE parcel_id = :id`,
    { id: parcelId },
  );
  const proFormas = await db.query(
    `SELECT scenario, inputs, arv_low, arv_high, allin_low, allin_high,
            profit_low, profit_high, created_by, created_at
     FROM pro_formas WHERE parcel_id = :id ORDER BY created_at DESC`,
    { id: parcelId },
  );
  const scores = await db.query(
    `SELECT run_date, score, rank, profit_mid, flags, summary
     FROM scores WHERE parcel_id = :id ORDER BY run_date DESC LIMIT 1`,
    { id: parcelId },
  );
  return { parcel, listings, research, proFormas, score: scores[0] ?? null };
}

async function saveProForma(
  db: Db,
  parcelId: string,
  sub: string,
  body: { name?: string; land?: number; inputs?: Partial<ProFormaInputs> },
) {
  // ARV comes from the auto scenario (CMA-derived). User overrides cost inputs/land.
  const [auto] = await db.query<{ arv_low: number | null; arv_high: number | null; land: number | null }>(
    `SELECT arv_low, arv_high, (inputs->>'land')::numeric AS land
     FROM pro_formas WHERE parcel_id = :id AND scenario = 'auto'`,
    { id: parcelId },
  );
  const inputs: ProFormaInputs = { ...DEFAULT_PRO_FORMA_INPUTS, ...(body.inputs ?? {}) };
  const land = body.land ?? auto?.land ?? 0;
  const pf = computeProForma(land, auto?.arv_low ?? null, auto?.arv_high ?? null, inputs);
  const scenario = `user:${sub}:${body.name ?? 'scenario'}`;

  await upsertProForma(db, parcelId, {
    scenario,
    inputs: { ...inputs, land },
    arvLow: pf.arv_low,
    arvHigh: pf.arv_high,
    allinLow: pf.allin_low,
    allinHigh: pf.allin_high,
    profitLow: pf.profit_low,
    profitHigh: pf.profit_high,
    createdBy: sub || null,
  });
  return { scenario, proForma: pf };
}

let s3: S3Client | null = null;
function s3Client(): S3Client {
  if (!s3) s3 = new S3Client({ region: process.env.AWS_REGION });
  return s3;
}

/** Generate the 2-page memo, store it in S3, and return a presigned download URL. */
async function buildReport(db: Db, parcelId: string): Promise<{ url: string; key: string } | { error: string }> {
  const detail = (await getParcelDetail(db, parcelId)) as ParcelDetail & { error?: string };
  if (detail.error) return { error: 'not_found' };

  const today = new Date().toISOString().slice(0, 10);
  const bytes = await buildMemoPdf(detailToMemoData(detail, today));

  const bucket = requireEnv('BUCKET');
  const key = `reports/${parcelId}/${today}.pdf`;
  await s3Client().send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: 'application/pdf' }),
  );
  // Cast around the @smithy/types version-identity skew between client-s3 and
  // s3-request-presigner (private `handlers` property) — runtime shape is correct.
  const url = await getSignedUrl(
    s3Client() as never,
    new GetObjectCommand({ Bucket: bucket, Key: key }) as never,
    { expiresIn: 3600 },
  );
  return { url, key };
}

function parseBody(event: APIGatewayProxyEventV2WithJWTAuthorizer): Record<string, unknown> {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseFilters(q: Record<string, string | undefined>): ParcelFilters {
  return {
    city: q.city || undefined,
    propertyType: q.propertyType || undefined,
    minPrice: numOrUndef(q.minPrice),
    maxPrice: numOrUndef(q.maxPrice),
    minLotAcres: numOrUndef(q.minLotAcres),
    minScore: numOrUndef(q.minScore),
    limit: numOrUndef(q.limit),
    offset: numOrUndef(q.offset),
  };
}

function numOrUndef(v: string | undefined): number | undefined {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
