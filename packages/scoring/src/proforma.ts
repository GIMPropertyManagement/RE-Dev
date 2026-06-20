import {
  DEFAULT_PRO_FORMA_INPUTS,
  TARGET_MARGIN_PCT,
  type ProFormaInputs,
} from './config.js';

export interface ProFormaResult {
  land_cost: number;
  arv_low: number | null;
  arv_high: number | null;
  allin_low: number;
  allin_high: number;
  profit_low: number | null;
  profit_high: number | null;
  profit_mid: number | null;
  margin_pct: number | null;
  /** Approx peak cash need (the high-side all-in). */
  peak_cash: number;
  fits_cap: boolean;
}

function fixed(inputs: ProFormaInputs, side: 'low' | 'high'): number {
  return side === 'low'
    ? inputs.site_work_low + inputs.soft_costs_low + inputs.carry_low + inputs.utility_connections
    : inputs.site_work_high + inputs.soft_costs_high + inputs.carry_high + inputs.utility_connections;
}

/**
 * The 33 Russo math. profit_low pairs the conservative ARV with the high cost;
 * profit_high pairs the optimistic ARV with the low cost. peak_cash is the
 * high-side all-in; fits_cap compares it to the configured cash ceiling.
 */
export function computeProForma(
  landCost: number,
  arvLow: number | null,
  arvHigh: number | null,
  inputs: ProFormaInputs = DEFAULT_PRO_FORMA_INPUTS,
): ProFormaResult {
  const hardLow = inputs.target_sqft * inputs.hard_cost_psf_low;
  const hardHigh = inputs.target_sqft * inputs.hard_cost_psf_high;

  const allinLow = landCost + hardLow + fixed(inputs, 'low');
  const allinHigh = landCost + hardHigh + fixed(inputs, 'high');
  const allinMid = (allinLow + allinHigh) / 2;

  const netLow = arvLow != null ? arvLow * (1 - inputs.sell_cost_pct) : null;
  const netHigh = arvHigh != null ? arvHigh * (1 - inputs.sell_cost_pct) : null;

  const profitLow = netLow != null ? Math.round(netLow - allinHigh) : null;
  const profitHigh = netHigh != null ? Math.round(netHigh - allinLow) : null;
  const profitMid =
    profitLow != null && profitHigh != null ? Math.round((profitLow + profitHigh) / 2) : null;
  const marginPct = profitMid != null && allinMid > 0 ? profitMid / allinMid : null;

  return {
    land_cost: landCost,
    arv_low: arvLow,
    arv_high: arvHigh,
    allin_low: Math.round(allinLow),
    allin_high: Math.round(allinHigh),
    profit_low: profitLow,
    profit_high: profitHigh,
    profit_mid: profitMid,
    margin_pct: marginPct,
    peak_cash: Math.round(allinHigh),
    fits_cap: allinHigh <= inputs.all_in_cash_cap,
  };
}

/**
 * Suggested offer = the lower of (a) a market-driven discount off list that
 * widens with days-on-market and price cuts (Russo: 14 mo + two cuts → well
 * under ask), and (b) the most you can pay for land and still clear the target
 * margin. Returns null when there's nothing to anchor on.
 */
export function suggestOffer(params: {
  listPrice: number | null;
  dom: number | null;
  priceCuts: number;
  arvMid: number | null;
  inputs?: ProFormaInputs;
  targetMarginPct?: number;
}): { offer: number | null; marketOffer: number | null; maxLandForMargin: number | null } {
  const inputs = params.inputs ?? DEFAULT_PRO_FORMA_INPUTS;
  const targetMargin = params.targetMarginPct ?? TARGET_MARGIN_PCT;

  const discount = clamp(
    0.03 + 0.02 * params.priceCuts + Math.min(0.1, Math.floor((params.dom ?? 0) / 90) * 0.02),
    0,
    0.3,
  );
  const marketOffer = params.listPrice != null ? Math.round(params.listPrice * (1 - discount)) : null;

  // Max land that still clears target margin, using mid costs.
  let maxLand: number | null = null;
  if (params.arvMid != null) {
    const hardMid = inputs.target_sqft * (inputs.hard_cost_psf_low + inputs.hard_cost_psf_high) / 2;
    const fixedMid = (fixed(inputs, 'low') + fixed(inputs, 'high')) / 2;
    const net = params.arvMid * (1 - inputs.sell_cost_pct);
    maxLand = Math.round(net - hardMid - fixedMid - targetMargin * params.arvMid);
  }

  const candidates = [marketOffer, maxLand].filter((x): x is number => x != null);
  const offer = candidates.length ? Math.min(...candidates) : null;
  return { offer, marketOffer, maxLandForMargin: maxLand };
}

/**
 * If peak cash exceeds the cap, the largest target_sqft (rounded down to 100 SF)
 * that fits, given the land cost. Returns null if it already fits or no sane
 * size fits.
 */
export function smallerSqftVariant(
  landCost: number,
  inputs: ProFormaInputs = DEFAULT_PRO_FORMA_INPUTS,
): number | null {
  const allinHigh = landCost + inputs.target_sqft * inputs.hard_cost_psf_high + fixed(inputs, 'high');
  if (allinHigh <= inputs.all_in_cash_cap) return null; // already fits

  const room = inputs.all_in_cash_cap - landCost - fixed(inputs, 'high');
  if (room <= 0) return null;
  const sqft = Math.floor(room / inputs.hard_cost_psf_high / 100) * 100;
  return sqft >= 1200 ? sqft : null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
