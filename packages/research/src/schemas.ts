/**
 * Per-kind payload types + (for the LLM kinds) JSON schemas for
 * output_config.format. Schemas are written to the structured-outputs subset:
 * type-unions with null, enum, additionalProperties:false, format 'uri'. They do
 * NOT use numeric min/max or minItems (unenforced) — those invariants are
 * re-checked in code after parse().
 */

import type { NeedsHumanReason } from '@forge/shared';

const NEEDS_HUMAN_REASON_VALUES: NeedsHumanReason[] = [
  'no_source_found',
  'sources_conflict',
  'url_unverifiable',
  'low_confidence_financial',
  'parcel_unresolved',
  'budget_exceeded',
];

const SOURCE_ITEM = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'url'],
  properties: {
    title: { type: 'string' },
    url: { type: 'string', format: 'uri' },
  },
} as const;

/** Meta fields every LLM kind must return (folded into the ResearchResult envelope). */
const META_PROPS = {
  sources: { type: 'array', items: SOURCE_ITEM },
  confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  needs_human: { type: 'boolean' },
  needs_human_reasons: {
    type: 'array',
    items: { type: 'string', enum: NEEDS_HUMAN_REASON_VALUES },
  },
} as const;
const META_REQUIRED = ['sources', 'confidence', 'needs_human', 'needs_human_reasons'];

// ---- Zoning (LLM) ----------------------------------------------------------
export interface ZoningPayload {
  district: string | null;
  min_lot_sqft: number | null;
  min_frontage_ft: number | null;
  setbacks: { front: number | null; side: number | null; rear: number | null } | null;
  max_coverage_pct: number | null;
  max_height_ft: number | null;
  allowed_uses: string[];
  adu_allowed: boolean | null;
  lot_of_record_protection: boolean | null;
  variance_needed: string[];
  notes: string | null;
}

export const ZONING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'district',
    'min_lot_sqft',
    'min_frontage_ft',
    'setbacks',
    'max_coverage_pct',
    'max_height_ft',
    'allowed_uses',
    'adu_allowed',
    'lot_of_record_protection',
    'variance_needed',
    'notes',
    ...META_REQUIRED,
  ],
  properties: {
    district: { type: ['string', 'null'] },
    min_lot_sqft: { type: ['number', 'null'] },
    min_frontage_ft: { type: ['number', 'null'] },
    setbacks: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['front', 'side', 'rear'],
      properties: {
        front: { type: ['number', 'null'] },
        side: { type: ['number', 'null'] },
        rear: { type: ['number', 'null'] },
      },
    },
    max_coverage_pct: { type: ['number', 'null'] },
    max_height_ft: { type: ['number', 'null'] },
    allowed_uses: { type: 'array', items: { type: 'string' } },
    adu_allowed: { type: ['boolean', 'null'] },
    lot_of_record_protection: { type: ['boolean', 'null'] },
    variance_needed: { type: 'array', items: { type: 'string' } },
    notes: { type: ['string', 'null'] },
    ...META_PROPS,
  },
} as const;

// ---- CMA (LLM) -------------------------------------------------------------
export interface CmaComp {
  address: string | null;
  sold_price: number | null;
  sqft: number | null;
  ppsf: number | null;
  sold_date: string | null;
  distance_mi: number | null;
  source_url: string | null;
}
export interface CmaPayload {
  recommended_product: string | null;
  target_sqft: number | null;
  comps: CmaComp[];
  ppsf_low: number | null;
  ppsf_median: number | null;
  ppsf_high: number | null;
  arv_low: number | null;
  arv_high: number | null;
  avm_cross_check: { value: number | null; divergence_pct: number | null } | null;
  notes: string | null;
}

export const CMA_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'recommended_product',
    'target_sqft',
    'comps',
    'ppsf_low',
    'ppsf_median',
    'ppsf_high',
    'arv_low',
    'arv_high',
    'avm_cross_check',
    'notes',
    ...META_REQUIRED,
  ],
  properties: {
    recommended_product: { type: ['string', 'null'] },
    target_sqft: { type: ['number', 'null'] },
    comps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['address', 'sold_price', 'sqft', 'ppsf', 'sold_date', 'distance_mi', 'source_url'],
        properties: {
          address: { type: ['string', 'null'] },
          sold_price: { type: ['number', 'null'] },
          sqft: { type: ['number', 'null'] },
          ppsf: { type: ['number', 'null'] },
          sold_date: { type: ['string', 'null'] },
          distance_mi: { type: ['number', 'null'] },
          source_url: { type: ['string', 'null'] },
        },
      },
    },
    ppsf_low: { type: ['number', 'null'] },
    ppsf_median: { type: ['number', 'null'] },
    ppsf_high: { type: ['number', 'null'] },
    arv_low: { type: ['number', 'null'] },
    arv_high: { type: ['number', 'null'] },
    avm_cross_check: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['value', 'divergence_pct'],
      properties: {
        value: { type: ['number', 'null'] },
        divergence_pct: { type: ['number', 'null'] },
      },
    },
    notes: { type: ['string', 'null'] },
    ...META_PROPS,
  },
} as const;

// ---- Deterministic kinds (GIS-derived; no LLM) -----------------------------
export interface FloodPayload {
  flood_zone: string | null;
  zone_subtype: string | null;
  mapped: boolean;
  in_sfha: boolean | null; // Special Flood Hazard Area (A/V zones)
}
export interface WetlandsPayload {
  intersects: boolean;
  types: string[];
  screening_only: true;
}
export interface TopoPayload {
  center_elev_m: number | null;
  sample_elevs_m: number[];
  relief_m: number | null;
  slope_pct_est: number | null;
  walkout_potential: boolean | null;
  ledge_risk: boolean | null;
}
export interface OwnershipPayload {
  owner: string | null;
  use_code: string | null;
  lot_acres: number | null;
  assessed_total: number | null;
  land_val: number | null;
  fy: number | null;
  last_sale_date: string | null;
  last_sale_price: number | null;
  hold_years: number | null;
}

// ---- Feasibility (Phase 3 synthesis) ---------------------------------------
export interface FeasibilityPayload {
  score: number;
  profit_low: number | null;
  profit_mid: number | null;
  profit_high: number | null;
  recommended_product: string | null;
  recommended_offer: number | null;
  summary: string | null;
}
