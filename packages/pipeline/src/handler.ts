import { Db } from '@forge/db';
import { RepliersProvider } from '@forge/providers';
import { runIngest, type IngestResult } from './ingest.js';
import { getSecretJsonField } from './secrets.js';

/**
 * EventBridge-scheduled ingest Lambda.
 *
 * Runs OUTSIDE the VPC: it reaches Repliers/Census/MassGIS over the internet and
 * Aurora over the RDS Data API (an HTTPS AWS endpoint) — so no NAT Gateway is
 * needed for this function. See ARCHITECTURE.md (NAT split).
 *
 * Env: CLUSTER_ARN, DB_SECRET_ARN, DB_NAME, REPLIERS_SECRET_ARN, AWS_REGION.
 */
export async function handler(): Promise<IngestResult> {
  const region = process.env.AWS_REGION;
  const db = new Db({
    resourceArn: requireEnv('CLUSTER_ARN'),
    secretArn: requireEnv('DB_SECRET_ARN'),
    database: process.env.DB_NAME ?? 'forge',
    region,
  });

  const apiKey = await getSecretJsonField(requireEnv('REPLIERS_SECRET_ARN'), 'apiKey', region);
  const boardId = process.env.REPLIERS_BOARD_ID
    ? Number(process.env.REPLIERS_BOARD_ID)
    : undefined;
  const provider = new RepliersProvider({ apiKey, boardId });

  const result = await runIngest(db, provider, (msg, extra) =>
    console.log(JSON.stringify({ msg, ...extra })),
  );
  console.log(JSON.stringify({ msg: 'ingest_complete', ...result }));
  return result;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
