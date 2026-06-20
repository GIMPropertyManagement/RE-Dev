import type { Confidence, RiskFlag } from '@forge/shared';
import type {
  CmaPayload,
  FloodPayload,
  ResearchResult,
  TopoPayload,
  WetlandsPayload,
  ZoningPayload,
} from '@forge/research';
import { DEFAULT_PRO_FORMA_INPUTS, type ProFormaInputs } from './config.js';
import { deriveFlags, type ResearchBag } from './flags.js';
import {
  computeProForma,
  smallerSqftVariant,
  suggestOffer,
  type ProFormaResult,
} from './proforma.js';
import { computeScore, type ScoreBreakdown } from './score.js';

export interface FeasibilityInput {
  listPrice: number | null;
  originalListPrice?: number | null;
  dom: number | null;
  /** The orchestrator's by-kind research results for this parcel. */
  research: Record<string, ResearchResult>;
  inputs?: ProFormaInputs;
}

export interface Feasibility {
  proForma: ProFormaResult;
  score: number;
  components: ScoreBreakdown['components'];
  flags: RiskFlag[];
  confidence: Confidence;
  recommendedProduct: string | null;
  recommendedOffer: number | null;
  smallerSqftVariant: number | null;
  profitMid: number | null;
  summary: string;
}

/**
 * Deterministic feasibility synthesis: combine the research bag + the pro forma
 * into a score, flags, recommended offer, and a one-paragraph summary. Land basis
 * is the *recommended offer* (the deal we'd actually do), not list. Kept
 * arithmetic-only for reliability; an optional LLM polish of `summary` can be
 * layered later without changing the numbers.
 */
export function synthesizeFeasibility(input: FeasibilityInput): Feasibility {
  const inputs = input.inputs ?? DEFAULT_PRO_FORMA_INPUTS;
  const bag = toBag(input.research);
  const cma = bag.cma;

  const arvLow = cma?.arv_low ?? null;
  const arvHigh = cma?.arv_high ?? null;
  const arvMid = arvLow != null && arvHigh != null ? (arvLow + arvHigh) / 2 : (arvLow ?? arvHigh);

  const priceCuts =
    input.originalListPrice != null &&
    input.listPrice != null &&
    input.originalListPrice > input.listPrice
      ? 1
      : 0;

  const offerRes = suggestOffer({
    listPrice: input.listPrice,
    dom: input.dom,
    priceCuts,
    arvMid,
    inputs,
  });
  const landCost = offerRes.offer ?? input.listPrice ?? 0;

  const proForma = computeProForma(landCost, arvLow, arvHigh, inputs);
  const confidence = overallConfidence(input.research);
  const flags = deriveFlags(bag, proForma, confidence);
  const compDepth = cma?.comps.length ?? 0;

  const { score, components } = computeScore({
    profitMid: proForma.profit_mid,
    marginPct: proForma.margin_pct,
    flags,
    confidence,
    compDepth,
  });

  const variant = proForma.fits_cap ? null : smallerSqftVariant(landCost, inputs);
  const recommendedProduct =
    cma?.recommended_product ?? `New single-family ~${inputs.target_sqft.toLocaleString()} SF`;

  return {
    proForma,
    score,
    components,
    flags,
    confidence,
    recommendedProduct,
    recommendedOffer: offerRes.offer,
    smallerSqftVariant: variant,
    profitMid: proForma.profit_mid,
    summary: buildSummary({ proForma, offer: offerRes.offer, flags, recommendedProduct, variant }),
  };
}

function toBag(research: Record<string, ResearchResult>): ResearchBag {
  return {
    flood: research.flood?.payload as FloodPayload | undefined,
    wetlands: research.wetlands?.payload as WetlandsPayload | undefined,
    topo: research.topo?.payload as TopoPayload | undefined,
    zoning: research.zoning?.payload as ZoningPayload | undefined,
    cma: research.cma?.payload as CmaPayload | undefined,
  };
}

const RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };
function overallConfidence(research: Record<string, ResearchResult>): Confidence {
  const vals = Object.values(research).map((r) => r.confidence);
  if (!vals.length) return 'low';
  const min = Math.min(...vals.map((c) => RANK[c]));
  return (Object.keys(RANK) as Confidence[]).find((k) => RANK[k] === min) ?? 'low';
}

function buildSummary(p: {
  proForma: ProFormaResult;
  offer: number | null;
  flags: RiskFlag[];
  recommendedProduct: string;
  variant: number | null;
}): string {
  const m = (n: number | null) => (n == null ? '?' : `$${Math.round(n).toLocaleString()}`);
  const pf = p.proForma;
  const parts = [
    `${p.recommendedProduct}.`,
    `ARV ${m(pf.arv_low)}–${m(pf.arv_high)}, all-in ${m(pf.allin_low)}–${m(pf.allin_high)}, profit ${m(pf.profit_low)}–${m(pf.profit_high)} (mid ${m(pf.profit_mid)}).`,
    p.offer != null ? `Recommended offer ${m(p.offer)}.` : '',
    pf.fits_cap
      ? ''
      : `Over cash cap (peak ${m(pf.peak_cash)})${p.variant ? ` — consider ~${p.variant.toLocaleString()} SF` : ''}.`,
    p.flags.length ? `Risks: ${p.flags.map((f) => f.code).join(', ')}.` : 'No major risk flags.',
  ];
  return parts.filter(Boolean).join(' ');
}
