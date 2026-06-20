import { describe, expect, it } from 'vitest';
import { normalizeRepliersListing, type RepliersRawListing } from '../src/normalize.js';
import { RepliersProvider } from '../src/repliers.js';
import page from './fixtures/repliers-listings-page.json' with { type: 'json' };

describe('normalizeRepliersListing', () => {
  it('maps a sold vacant-land listing into RESO fields', () => {
    const raw = (page.listings as RepliersRawListing[])[0];
    const n = normalizeRepliersListing(raw);

    expect(n.listingKey).toBe('73000001');
    expect(n.standardStatus).toBe('Closed'); // lastStatus Sld
    expect(n.propertyType).toBe('Land'); // detail "Vacant Land"
    expect(n.listPrice).toBe(250000);
    expect(n.originalListPrice).toBe(279000);
    expect(n.closePrice).toBe(200000);
    expect(n.lotSizeAcres).toBe(1.5);
    expect(n.lotSizeSquareFeet).toBe(65340);
    expect(n.zoning).toBe('RA');
    expect(n.latitude).toBeCloseTo(42.2287, 3);
    expect(n.modificationTimestamp).toBe('2025-04-16T10:00:00Z');
    expect(n.unparsedAddress).toContain('33 Russo Dr');
    expect(n.unparsedAddress).toContain('Hopkinton');
  });

  it('maps an active single-family listing', () => {
    const raw = (page.listings as RepliersRawListing[])[1];
    const n = normalizeRepliersListing(raw);

    expect(n.standardStatus).toBe('Active');
    expect(n.propertyType).toBe('Residential');
    expect(n.listPrice).toBe(614900);
    expect(n.livingArea).toBe(2200);
    expect(n.yearBuilt).toBe(1992);
  });

  it('derives lot sqft from acres when sqft missing', () => {
    const raw: RepliersRawListing = { mlsNumber: 'x', status: 'A', lot: { acres: 2 } };
    const n = normalizeRepliersListing(raw);
    expect(n.lotSizeSquareFeet).toBe(87120); // 2 * 43560
  });

  it('falls back to Unknown status for unrecognized codes', () => {
    const raw: RepliersRawListing = { mlsNumber: 'x', status: 'Q', lastStatus: 'Zzz' };
    expect(normalizeRepliersListing(raw).standardStatus).toBe('Unknown');
  });
});

describe('RepliersProvider.fetchChangedSince', () => {
  it('paginates, normalizes, and drops rows at/under the watermark', async () => {
    const page2 = {
      page: 2,
      numPages: 2,
      count: 3,
      listings: [
        {
          mlsNumber: '73000003',
          status: 'A',
          lastStatus: 'Pc',
          listPrice: 399000,
          updatedOn: '2025-06-03T00:00:00Z',
          type: 'Sale',
          class: 'residential',
          address: { city: 'Natick', state: 'MA', zip: '01760' },
        },
        {
          // This one is older than the watermark and must be filtered out.
          mlsNumber: '73000000',
          status: 'A',
          updatedOn: '2025-01-01T00:00:00Z',
          type: 'Sale',
          class: 'residential',
        },
      ],
    };

    const calls: string[] = [];
    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      const pageNum = new URL(url).searchParams.get('pageNum');
      const bodyObj = pageNum === '2' ? page2 : page;
      return new Response(JSON.stringify(bodyObj), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const provider = new RepliersProvider({ apiKey: 'test-key', fetchImpl: fakeFetch });
    const since = '2025-04-16T10:00:00Z'; // == listing #1's timestamp

    const out = [];
    for await (const l of provider.fetchChangedSince(since)) out.push(l);

    // #1 (== watermark) dropped, #00000 (< watermark) dropped, #2 and #3 kept.
    const keys = out.map((l) => l.listingKey).sort();
    expect(keys).toEqual(['73000002', '73000003']);
    // Two pages fetched; auth header + key sent.
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('minUpdatedOn=2025-04-16T10');
    expect(calls[0]).toContain('sortBy=updatedOnAsc');
  });

  it('sends the REPLIERS-API-KEY header', async () => {
    let seenHeader: string | null = null;
    const fakeFetch: typeof fetch = async (_input, init) => {
      seenHeader = new Headers(init?.headers).get('REPLIERS-API-KEY');
      return new Response(JSON.stringify({ listings: [], numPages: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const provider = new RepliersProvider({ apiKey: 'sekret', fetchImpl: fakeFetch });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of provider.fetchChangedSince(null)) { /* drain */ }
    expect(seenHeader).toBe('sekret');
  });
});
