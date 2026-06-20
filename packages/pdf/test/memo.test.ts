import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { buildMemoPdf } from '../src/memo.js';
import { detailToMemoData, type ParcelDetail } from '../src/mapper.js';

const DETAIL: ParcelDetail = {
  parcel: { id: 'p1', loc_id: 'M_1_1', address: '33 Russo Dr, Hopkinton, MA', city: 'Hopkinton' },
  listings: [{ list_price: 250000, standard_status: 'Active' }],
  research: [
    {
      kind: 'zoning',
      payload: {
        district: 'RA',
        min_lot_sqft: 60000,
        min_frontage_ft: 175,
        variance_needed: ['frontage 150 < 175 min'],
        adu_allowed: true,
      },
      sources: [{ title: 'Hopkinton Zoning Bylaw §210', url: 'https://www.hopkintonma.gov/zoning.pdf' }],
    },
    { kind: 'flood', payload: { flood_zone: 'X', in_sfha: false, mapped: true }, sources: [] },
    { kind: 'wetlands', payload: { intersects: true, types: ['BVW'] }, sources: [] },
    {
      kind: 'cma',
      payload: {
        recommended_product: 'New single-family ~3,200 SF',
        comps: [
          { address: '5 Oak St', sold_price: 620000, sqft: 2000, ppsf: 310, sold_date: '2025-04-01', distance_mi: 0.4 },
        ],
      },
      sources: [],
    },
  ],
  proFormas: [
    {
      scenario: 'auto',
      inputs: { land: 185000, recommended_product: 'New single-family ~3,200 SF', all_in_cash_cap: 700000 },
      arv_low: 900000,
      arv_high: 1000000,
      allin_low: 760000,
      allin_high: 892000,
      profit_low: -37000,
      profit_high: 190000,
    },
  ],
  score: { score: 78, profit_mid: 76500, flags: [{ code: 'wetlands' }, { code: 'frontage_variance' }], summary: 'Strong lot.' },
};

describe('detailToMemoData', () => {
  it('maps the API detail into memo data', () => {
    const m = detailToMemoData(DETAIL, '2026-06-20');
    expect(m.address).toContain('Russo');
    expect(m.score).toBe(78);
    expect(m.recommendedOffer).toBe(185000); // from auto inputs.land
    expect(m.proForma?.fitsCap).toBe(false); // 892k > 700k cap
    expect(m.zoning?.varianceNeeded).toHaveLength(1);
    expect(m.wetlands?.intersects).toBe(true);
    expect(m.comps).toHaveLength(1);
    expect(m.sources[0].url).toContain('hopkintonma.gov');
  });
});

describe('buildMemoPdf', () => {
  it('produces a valid multi-section PDF', async () => {
    const bytes = await buildMemoPdf(detailToMemoData(DETAIL, '2026-06-20'));
    expect(bytes.length).toBeGreaterThan(1000);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});
