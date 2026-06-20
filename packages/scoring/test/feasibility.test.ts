import { describe, expect, it } from 'vitest';
import type { ResearchResult } from '@forge/research';
import { synthesizeFeasibility } from '../src/feasibility.js';

function research(overrides: Record<string, Partial<ResearchResult>> = {}): Record<string, ResearchResult> {
  const base: Record<string, ResearchResult> = {
    cma: {
      kind: 'cma',
      payload: {
        recommended_product: 'New single-family ~3,200 SF',
        target_sqft: 3200,
        comps: Array.from({ length: 6 }, (_, i) => ({
          address: `c${i}`,
          sold_price: 600000,
          sqft: 2000,
          ppsf: 300,
          sold_date: '2025-05-01',
          distance_mi: 0.5,
          source_url: null,
        })),
        ppsf_low: 290,
        ppsf_median: 300,
        ppsf_high: 320,
        arv_low: 900_000,
        arv_high: 1_000_000,
        avm_cross_check: null,
        notes: null,
      },
      sources: [],
      confidence: 'high',
      needsHuman: false,
      needsHumanReasons: [],
    },
    flood: {
      kind: 'flood',
      payload: { flood_zone: 'X', zone_subtype: null, mapped: true, in_sfha: false },
      sources: [],
      confidence: 'high',
      needsHuman: false,
      needsHumanReasons: [],
    },
  };
  for (const [k, v] of Object.entries(overrides)) base[k] = { ...base[k], ...v } as ResearchResult;
  return base;
}

describe('synthesizeFeasibility', () => {
  it('produces a score, pro forma, offer, and summary', () => {
    const f = synthesizeFeasibility({
      listPrice: 250_000,
      originalListPrice: 279_000,
      dom: 420,
      research: research(),
    });
    expect(f.recommendedOffer).not.toBeNull();
    expect(f.proForma.arv_low).toBe(900_000);
    expect(f.score).toBeGreaterThanOrEqual(0);
    expect(f.score).toBeLessThanOrEqual(100);
    expect(f.summary).toMatch(/profit/i);
    // Default cap 700k with this all-in is exceeded -> over_cash_cap flag + variant.
    expect(f.flags.map((x) => x.code)).toContain('over_cash_cap');
    expect(f.smallerSqftVariant).not.toBeNull();
  });

  it('raises flags for flood + wetlands and lowers the score', () => {
    const clean = synthesizeFeasibility({ listPrice: 250_000, dom: 30, research: research() });
    const risky = synthesizeFeasibility({
      listPrice: 250_000,
      dom: 30,
      research: research({
        flood: {
          payload: { flood_zone: 'AE', zone_subtype: null, mapped: true, in_sfha: true },
        } as Partial<ResearchResult>,
        wetlands: {
          kind: 'wetlands',
          payload: { intersects: true, types: ['BVW'], screening_only: true },
          sources: [],
          confidence: 'medium',
          needsHuman: true,
          needsHumanReasons: ['screening_only'],
        } as Partial<ResearchResult>,
      }),
    });
    const codes = risky.flags.map((f) => f.code);
    expect(codes).toContain('flood_zone');
    expect(codes).toContain('wetlands');
    expect(risky.score).toBeLessThan(clean.score);
  });

  it('flags thin comps and drops liquidity', () => {
    const f = synthesizeFeasibility({
      listPrice: 250_000,
      dom: 30,
      research: research({
        cma: {
          kind: 'cma',
          payload: {
            recommended_product: null,
            target_sqft: 3200,
            comps: [
              { address: 'c1', sold_price: 600000, sqft: 2000, ppsf: 300, sold_date: '2025-05-01', distance_mi: 0.5, source_url: null },
            ],
            ppsf_low: 300,
            ppsf_median: 300,
            ppsf_high: 300,
            arv_low: 900_000,
            arv_high: 960_000,
            avm_cross_check: null,
            notes: null,
          },
          sources: [],
          confidence: 'low',
          needsHuman: true,
          needsHumanReasons: ['low_confidence_financial'],
        } as Partial<ResearchResult>,
      }),
    });
    expect(f.flags.map((x) => x.code)).toContain('thin_comps');
    expect(f.confidence).toBe('low');
  });
});
