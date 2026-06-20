import { Db } from '@forge/db';
import { RepliersProvider } from '@forge/providers';
import { ResearchLlm } from '@forge/research';
import { runDailyEnrich, type DailyEnrichResult } from './enrich.js';
import { getSecretJsonField } from './secrets.js';

/**
 * Daily enrich Lambda (runs after ingest). For parcels not yet scored today:
 * research → feasibility → persist auto pro forma + score, then rank the run.
 * Outside the VPC (Data API + external Repliers/Claude/GIS) → no NAT.
 *
 * Env: CLUSTER_ARN, DB_SECRET_ARN, DB_NAME, REPLIERS_SECRET_ARN,
 *      CLAUDE_SECRET_ARN (optional — zoning is skipped/needs_human without it),
 *      ENRICH_LIMIT (optional), AWS_REGION.
 */
export async function enrichHandler(): Promise<DailyEnrichResult> {
  const region = process.env.AWS_REGION;
  const db = new Db({
    resourceArn: requireEnv('CLUSTER_ARN'),
    secretArn: requireEnv('DB_SECRET_ARN'),
    database: process.env.DB_NAME ?? 'forge',
    region,
  });

  const apiKey = await getSecretJsonField(requireEnv('REPLIERS_SECRET_ARN'), 'apiKey', region);
  const boardId = process.env.REPLIERS_BOARD_ID ? Number(process.env.REPLIERS_BOARD_ID) : undefined;
  const comps = new RepliersProvider({ apiKey, boardId });

  let llm: ResearchLlm | undefined;
  if (process.env.CLAUDE_SECRET_ARN) {
    const claudeKey = await getSecretJsonField(process.env.CLAUDE_SECRET_ARN, 'apiKey', region);
    llm = new ResearchLlm({ apiKey: claudeKey });
  }

  const runDate = new Date().toISOString().slice(0, 10);
  const limit = process.env.ENRICH_LIMIT ? Number(process.env.ENRICH_LIMIT) : undefined;

  const result = await runDailyEnrich(db, { comps, llm }, runDate, {
    limit,
    log: (msg, extra) => console.log(JSON.stringify({ msg, ...extra })),
  });
  console.log(JSON.stringify({ msg: 'enrich_complete', ...result }));
  return result;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
