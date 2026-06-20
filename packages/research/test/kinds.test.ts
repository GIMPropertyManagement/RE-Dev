import { describe, expect, it } from 'vitest';
import type { MlsListing, MlsProvider } from '@forge/shared';
import { floodKind } from '../src/kinds/flood.js';
import { wetlandsKind } from '../src/kinds/wetlands.js';
import { topoKind } from '../src/kinds/topo.js';
import { ownershipKind } from '../src/kinds/ownership.js';
import { cmaKind } from '../src/kinds/cma.js';
import type { ResearchInput } from '../src/types.js';
import type {
  CmaPayload,
  FloodPayload,
  OwnershipPayload,
  TopoPayload,
  WetlandsPayload,
} from '../src/schemas.js';

const INPUT: ResearchInput = {
  parcelId: 'p1',
  locId: 'M_1_1',
  lat: 42.2287,
  lng: -71.5226,
  address: '33 Russo Dr, Hopkinton, MA',
  town: 'Hopkinton',
  lotAcres: 1.5,
  zoningHint: 'RA',
  l3: null,
};

function jsonResponse(obj: unknown): Response {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('floodKind (deterministic, FEMA NFHL)', () => {
  it('maps an AE zone as SFHA with high confidence', async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({ features: [{ attributes: { FLD_ZONE: 'AE', ZONE_SUBTY: 'FLOODWAY' } }] });
    const r = await floodKind(INPUT, { fetchImpl });
    const p = r.payload as FloodPayload;
    expect(p.flood_zone).toBe('AE');
    expect(p.in_sfha).toBe(true);
    expect(r.confidence).toBe('high');
    expect(r.needsHuman).toBe(false);
    expect(r.sources[0].url).toContain('NFHL');
  });

  it('flags needs_human when the point is unmapped (empty != Zone X)', async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({ features: [] });
    const r = await floodKind(INPUT, { fetchImpl });
    expect((r.payload as FloodPayload).mapped).toBe(false);
    expect(r.needsHuman).toBe(true);
  });
});

describe('wetlandsKind (deterministic, MassDEP screen)', () => {
  it('flags screening_only needs_human on an intersect', async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({ features: [{ attributes: { IT_VALDESC: 'Bordering Vegetated Wetland' } }] });
    const r = await wetlandsKind(INPUT, { fetchImpl });
    const p = r.payload as WetlandsPayload;
    expect(p.intersects).toBe(true);
    expect(p.types).toContain('Bordering Vegetated Wetland');
    expect(r.confidence).toBe('medium');
    expect(r.needsHumanReasons).toContain('screening_only');
  });
});

describe('topoKind (deterministic, LiDAR DEM sampling)', () => {
  it('computes relief and slope across the envelope', async () => {
    const values = ['10', '12', '8', '11', '9'];
    let i = 0;
    const fetchImpl: typeof fetch = async () => jsonResponse({ value: values[i++] });
    const r = await topoKind(INPUT, { fetchImpl });
    const p = r.payload as TopoPayload;
    expect(p.center_elev_m).toBe(10);
    expect(p.relief_m).toBe(4); // 12 - 8
    expect(p.walkout_potential).toBe(true); // 4m >= 2.4m
    expect(r.confidence).toBe('high');
  });
});

describe('ownershipKind (deterministic, MassGIS L3)', () => {
  it('reads assessor fields from L3 attributes', async () => {
    const input: ResearchInput = {
      ...INPUT,
      l3: {
        OWNER1: 'DOE JOHN',
        USE_CODE: '130',
        LOT_SIZE: 1.5,
        TOTAL_VAL: 240000,
        LAND_VAL: 200000,
        FY: 2025,
        LS_DATE: '2011-05-01',
        LS_PRICE: 95000,
      },
    };
    const r = await ownershipKind(input, {});
    const p = r.payload as OwnershipPayload;
    expect(p.owner).toBe('DOE JOHN');
    expect(p.last_sale_price).toBe(95000);
    expect(p.hold_years).toBeGreaterThan(13);
    expect(r.confidence).toBe('high');
    expect(r.sources[0].url).toContain('L3Parcels');
  });

  it('needs human when the parcel is unresolved (no L3)', async () => {
    const r = await ownershipKind(INPUT, {});
    expect(r.needsHuman).toBe(true);
    expect(r.needsHumanReasons).toContain('parcel_unresolved');
  });
});

describe('cmaKind (deterministic, provider sold comps)', () => {
  it('computes $/SF and ARV from comps and cross-checks the AVM', async () => {
    const comps = [
      mkComp('c1', 600000, 2000),
      mkComp('c2', 640000, 2000),
      mkComp('c3', 560000, 2000),
      mkComp('c4', 660000, 2200),
      mkComp('c5', 620000, 2000),
    ];
    const provider: MlsProvider = {
      name: 'fake',
      async *fetchChangedSince() {},
      async fetchById() {
        return null;
      },
      async fetchSoldComps() {
        return comps;
      },
      async fetchEstimate() {
        return { value: 640000, raw: {} };
      },
    };
    const r = await cmaKind(INPUT, { comps: provider });
    const p = r.payload as CmaPayload;
    expect(p.comps).toHaveLength(5);
    expect(p.ppsf_median).toBe(300); // sorted 280,300,300,310,320
    expect(p.arv_low).toBe(280 * 3200);
    expect(p.arv_high).toBe(320 * 3200);
    expect(r.confidence).toBe('high');
    expect(r.needsHuman).toBe(false);
    expect(p.avm_cross_check?.value).toBe(640000);
    expect(p.notes).toMatch(/AVM diverges/);
  });

  it('flags thin comps as low confidence / needs_human', async () => {
    const provider: MlsProvider = {
      name: 'fake',
      async *fetchChangedSince() {},
      async fetchById() {
        return null;
      },
      async fetchSoldComps() {
        return [mkComp('c1', 600000, 2000)];
      },
    };
    const r = await cmaKind(INPUT, { comps: provider });
    expect(r.confidence).toBe('low');
    expect(r.needsHuman).toBe(true);
  });
});

function mkComp(key: string, price: number, sqft: number): MlsListing {
  return {
    listingKey: key,
    standardStatus: 'Closed',
    propertyType: 'Residential',
    modificationTimestamp: '2025-05-01T00:00:00Z',
    closePrice: price,
    livingArea: sqft,
    closeDate: '2025-05-01',
    latitude: 42.23,
    longitude: -71.52,
    unparsedAddress: `${key} Test St`,
    raw: {},
  };
}
