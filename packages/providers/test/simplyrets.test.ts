import { describe, expect, it } from 'vitest';
import type { MlsProvider } from '@forge/shared';
import { RepliersProvider } from '../src/repliers.js';
import { SimplyRetsProvider, normalizeSimplyRetsListing } from '../src/simplyrets.js';

describe('normalizeSimplyRetsListing', () => {
  it('maps a SimplyRETS land listing into the RESO model', () => {
    const n = normalizeSimplyRetsListing({
      mlsId: 12345,
      listingId: '73000001',
      listPrice: 250000,
      originalListPrice: 279000,
      listDate: '2024-02-01T00:00:00Z',
      modified: '2025-04-16T10:00:00Z',
      address: { full: '33 Russo Dr, Hopkinton, MA', streetNumber: '33', streetName: 'Russo Dr', city: 'Hopkinton', state: 'MA', postalCode: '01748' },
      geo: { lat: 42.2287, lng: -71.5226, county: 'Middlesex' },
      property: { type: 'LND', lotSizeArea: 1.5, lotSizeUnits: 'Acres', zoning: 'RA' },
      mls: { status: 'Closed', daysOnMarket: 439 },
      sales: { closeDate: '2025-04-15T00:00:00Z', closePrice: 200000 },
    });

    expect(n.listingKey).toBe('12345');
    expect(n.standardStatus).toBe('Closed');
    expect(n.propertyType).toBe('Land');
    expect(n.closePrice).toBe(200000);
    expect(n.lotSizeAcres).toBe(1.5);
    expect(n.lotSizeSquareFeet).toBe(65340);
    expect(n.zoning).toBe('RA');
    expect(n.modificationTimestamp).toBe('2025-04-16T10:00:00Z');
    expect(n.countyOrParish).toBe('Middlesex');
  });

  it('converts a square-feet lot to acres', () => {
    const n = normalizeSimplyRetsListing({
      mlsId: 1,
      property: { type: 'RES', lotSizeArea: 43560, lotSizeUnits: 'Square Feet' },
      mls: { status: 'Active' },
    });
    expect(n.lotSizeAcres).toBe(1);
  });
});

describe('provider seam (swap is a one-file change)', () => {
  it('both providers satisfy MlsProvider', () => {
    const repliers: MlsProvider = new RepliersProvider({ apiKey: 'k' });
    const simplyrets: MlsProvider = new SimplyRetsProvider({ apiKey: 'k', apiSecret: 's' });
    expect(repliers.name).toBe('repliers');
    expect(simplyrets.name).toBe('simplyrets');
    // The rest of the app depends only on these methods existing.
    for (const p of [repliers, simplyrets]) {
      expect(typeof p.fetchChangedSince).toBe('function');
      expect(typeof p.fetchById).toBe('function');
      expect(typeof p.fetchSoldComps).toBe('function');
    }
  });

  it('SimplyRetsProvider paginates newest-first and stops at the watermark', async () => {
    const page1 = [
      { mlsId: 3, modified: '2025-06-03T00:00:00Z', mls: { status: 'Active' }, property: { type: 'RES' }, address: { city: 'Natick' } },
      { mlsId: 2, modified: '2025-06-02T00:00:00Z', mls: { status: 'Active' }, property: { type: 'RES' }, address: { city: 'Framingham' } },
      { mlsId: 1, modified: '2025-01-01T00:00:00Z', mls: { status: 'Active' }, property: { type: 'RES' }, address: { city: 'Old' } },
    ];
    const fakeFetch: typeof fetch = async () =>
      new Response(JSON.stringify(page1), { status: 200, headers: { 'content-type': 'application/json' } });

    const provider = new SimplyRetsProvider({ apiKey: 'k', apiSecret: 's', fetchImpl: fakeFetch });
    const out = [];
    for await (const l of provider.fetchChangedSince('2025-06-01T00:00:00Z')) out.push(l.listingKey);
    expect(out).toEqual(['3', '2']); // mlsId 1 is older than the watermark → stop
  });
});
