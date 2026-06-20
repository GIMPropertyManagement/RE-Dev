import type { Confidence, RiskFlag } from '@forge/shared';
import { DEFAULT_WEIGHTS, SCORE_REFS, type ScoreWeights } from './config.js';

export interface ScoreInput {
  profitMid: number | null;
  marginPct: number | null;
  flags: RiskFlag[];
  confidence: Confidence;
  compDepth: number;
  weights?: ScoreWeights;
}

export interface ScoreBreakdown {
  score: number;
  components: { profit: number; margin: number; risk: number; confidence: number; liquidity: number };
}

/**
 * 0–100 composite (PRD §8): a weighted blend of profit, margin %, risk-flag
 * penalties, data confidence, and liquidity (comp depth). Weights are config and
 * tunable. Negative/absent profit collapses the profit component to 0.
 */
export function computeScore(input: ScoreInput): ScoreBreakdown {
  const w = input.weights ?? DEFAULT_WEIGHTS;

  const profit = clamp(((input.profitMid ?? 0) / SCORE_REFS.profitFull) * 100, 0, 100);
  const margin = clamp(((input.marginPct ?? 0) / SCORE_REFS.marginFull) * 100, 0, 100);
  const risk = clamp(100 - input.flags.length * SCORE_REFS.riskPenaltyPerFlag, 0, 100);
  const confidence = input.confidence === 'high' ? 100 : input.confidence === 'medium' ? 60 : 20;
  const liquidity = clamp((input.compDepth / SCORE_REFS.compDepthFull) * 100, 0, 100);

  const score = Math.round(
    profit * w.profit +
      margin * w.margin +
      risk * w.risk +
      confidence * w.confidence +
      liquidity * w.liquidity,
  );

  return {
    score,
    components: {
      profit: round1(profit),
      margin: round1(margin),
      risk: round1(risk),
      confidence,
      liquidity: round1(liquidity),
    },
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
