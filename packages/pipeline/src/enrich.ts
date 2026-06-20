import {
  Db,
  rankRun,
  selectParcelsToEnrich,
  upsertProForma,
  upsertScore,
  type EnrichCandidate,
} from '@forge/db';
import { resolveParcel } from '@forge/gis';
import { runParcelResearch, type ProducerDeps, type ResearchInput } from '@forge/research';
import { DEFAULT_PRO_FORMA_INPUTS, synthesizeFeasibility, type Feasibility } from '@forge/scoring';

export type EnrichDeps = ProducerDeps;

type Log = (msg: string, extra?: Record<string, unknown>) => void;

/**
 * Enrich one parcel: (re)run the research kinds, synthesize feasibility, and
 * persist the auto pro forma + the day's score. Ownership needs the L3 assessor
 * attributes, so we re-resolve the parcel from its point at enrich time.
 */
export async function enrichParcel(
  db: Db,
  c: EnrichCandidate,
  deps: EnrichDeps,
  runDate: string,
  log: Log = () => {},
): Promise<Feasibility> {
  let l3 = null;
  let locId: string | null = null;
  if (c.lat != null && c.lng != null) {
    const r = await resolveParcel({ lat: c.lat, lng: c.lng }, { fetchImpl: deps.fetchImpl });
    if (r.resolution === 'l3') {
      l3 = r.attributes;
      locId = r.locId;
    }
  }

  const input: ResearchInput = {
    parcelId: c.parcel_id,
    locId,
    lat: c.lat,
    lng: c.lng,
    address: c.address,
    town: c.city,
    lotAcres: c.lot_acres,
    zoningHint: c.zoning_code,
    l3,
  };

  const research = await runParcelResearch(db, input, deps, { materialChange: true, log });

  const feas = synthesizeFeasibility({
    listPrice: c.list_price,
    originalListPrice: c.original_list_price,
    dom: c.dom,
    research,
    inputs: DEFAULT_PRO_FORMA_INPUTS,
  });

  await upsertProForma(db, c.parcel_id, {
    scenario: 'auto',
    inputs: DEFAULT_PRO_FORMA_INPUTS,
    arvLow: feas.proForma.arv_low,
    arvHigh: feas.proForma.arv_high,
    allinLow: feas.proForma.allin_low,
    allinHigh: feas.proForma.allin_high,
    profitLow: feas.proForma.profit_low,
    profitHigh: feas.proForma.profit_high,
    createdBy: null,
  });

  await upsertScore(db, c.parcel_id, {
    runDate,
    score: feas.score,
    profitMid: feas.profitMid,
    flags: feas.flags,
    summary: feas.summary,
  });

  return feas;
}

export interface DailyEnrichResult {
  runDate: string;
  candidates: number;
  enriched: number;
  failed: number;
}

/** Select parcels needing enrichment, enrich each (isolated), then rank the run. */
export async function runDailyEnrich(
  db: Db,
  deps: EnrichDeps,
  runDate: string,
  opts: { limit?: number; log?: Log } = {},
): Promise<DailyEnrichResult> {
  const log = opts.log ?? (() => {});
  const candidates = await selectParcelsToEnrich(db, runDate, opts.limit ?? 200);
  let enriched = 0;
  let failed = 0;

  for (const c of candidates) {
    try {
      await enrichParcel(db, c, deps, runDate, log);
      enriched += 1;
    } catch (err) {
      failed += 1;
      log('enrich_parcel_failed', {
        parcelId: c.parcel_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await rankRun(db, runDate);
  return { runDate, candidates: candidates.length, enriched, failed };
}
