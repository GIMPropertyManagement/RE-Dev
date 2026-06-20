import { describe, expect, it } from 'vitest';
import { DEFAULT_PRO_FORMA_INPUTS } from '../src/config.js';
import { computeProForma, smallerSqftVariant, suggestOffer } from '../src/proforma.js';

describe('computeProForma (Russo math)', () => {
  it('computes all-in, profit range, peak cash, fits-cap', () => {
    // land 200k, ARV 900k–1.0M, default inputs (3200sf, $150-185/sf, etc.)
    const pf = computeProForma(200_000, 900_000, 1_000_000);

    // allin_low = 200k + 3200*150 + 40k + 20k + 20k + 0 = 200k+480k+80k = 760k
    expect(pf.allin_low).toBe(760_000);
    // allin_high = 200k + 3200*185 + 50k + 25k + 25k = 200k+592k+100k = 892k
    expect(pf.allin_high).toBe(892_000);
    // profit_low = 900k*0.95 - allin_high(892k) = 855k - 892k = -37k
    expect(pf.profit_low).toBe(-37_000);
    // profit_high = 1.0M*0.95 - allin_low(760k) = 950k - 760k = 190k
    expect(pf.profit_high).toBe(190_000);
    expect(pf.profit_mid).toBe(Math.round((-37_000 + 190_000) / 2));
    expect(pf.peak_cash).toBe(892_000);
    expect(pf.fits_cap).toBe(false); // 892k > 700k cap
  });

  it('respects a raised cash cap', () => {
    const pf = computeProForma(200_000, 900_000, 1_000_000, {
      ...DEFAULT_PRO_FORMA_INPUTS,
      all_in_cash_cap: 1_000_000,
    });
    expect(pf.fits_cap).toBe(true);
  });

  it('leaves profit null when ARV is unknown', () => {
    const pf = computeProForma(200_000, null, null);
    expect(pf.profit_mid).toBeNull();
    expect(pf.margin_pct).toBeNull();
  });
});

describe('suggestOffer', () => {
  it('widens the discount with DOM and price cuts (Russo: long DOM + cuts)', () => {
    const fresh = suggestOffer({ listPrice: 250_000, dom: 5, priceCuts: 0, arvMid: null });
    const stale = suggestOffer({ listPrice: 250_000, dom: 420, priceCuts: 2, arvMid: null });
    expect(stale.marketOffer!).toBeLessThan(fresh.marketOffer!);
  });

  it('caps the offer at the max land that clears target margin', () => {
    // Tiny ARV -> margin bound dominates and is well under list.
    const r = suggestOffer({ listPrice: 250_000, dom: 5, priceCuts: 0, arvMid: 800_000 });
    expect(r.maxLandForMargin).not.toBeNull();
    expect(r.offer).toBe(Math.min(r.marketOffer!, r.maxLandForMargin!));
  });
});

describe('smallerSqftVariant', () => {
  it('suggests a smaller footprint when over cap', () => {
    const v = smallerSqftVariant(200_000); // default cap 700k, default high $/sf
    expect(v).not.toBeNull();
    // room = 700k - 200k - 100k(fixed high) = 400k; 400k/185 = 2162 -> floor 2100
    expect(v).toBe(2100);
  });
  it('returns null when it already fits', () => {
    // allin_high = land + 3200*185 + 100k(fixed). Needs land <= ~8k to fit a 700k cap.
    expect(smallerSqftVariant(5_000)).toBeNull();
  });
});
