/**
 * Default pro forma inputs and score weights.
 *
 * These are the **33 Russo Drive-derived** defaults (self-perform single-family).
 * Every value is overridable per parcel/scenario in the pro forma editor — this
 * file is just the starting point. Tune freely; nothing downstream hardcodes
 * these numbers.
 */

export interface ProFormaInputs {
  target_sqft: number;
  hard_cost_psf_low: number;
  hard_cost_psf_high: number;
  site_work_low: number;
  site_work_high: number;
  soft_costs_low: number;
  soft_costs_high: number;
  carry_low: number;
  carry_high: number;
  utility_connections: number; // parcel-specific; 0 if fees already paid
  sell_cost_pct: number; // applied to ARV on exit
  all_in_cash_cap: number; // peak-cash ceiling
}

export const DEFAULT_PRO_FORMA_INPUTS: ProFormaInputs = {
  target_sqft: 3200, // midpoint of 3,000–3,400 SF
  hard_cost_psf_low: 150,
  hard_cost_psf_high: 185,
  site_work_low: 40_000,
  site_work_high: 50_000,
  soft_costs_low: 20_000,
  soft_costs_high: 25_000,
  carry_low: 20_000,
  carry_high: 25_000,
  utility_connections: 0,
  sell_cost_pct: 0.05,
  all_in_cash_cap: 700_000,
};

export interface ScoreWeights {
  profit: number;
  margin: number;
  risk: number;
  confidence: number;
  liquidity: number;
}

/** Weights sum to 1.0. Profit carries the most weight (PRD §8). */
export const DEFAULT_WEIGHTS: ScoreWeights = {
  profit: 0.4,
  margin: 0.2,
  risk: 0.15,
  confidence: 0.1,
  liquidity: 0.15,
};

/** Normalization references for the score components. */
export const SCORE_REFS = {
  /** profit_mid that maps to a full 100 on the profit component. */
  profitFull: 250_000,
  /** margin % that maps to a full 100 on the margin component. */
  marginFull: 0.3,
  /** comp count that maps to a full 100 on liquidity. */
  compDepthFull: 8,
  /** per-flag penalty on the risk component (out of 100). */
  riskPenaltyPerFlag: 18,
} as const;

/** Target developer margin used when suggesting an offer. */
export const TARGET_MARGIN_PCT = 0.2;
