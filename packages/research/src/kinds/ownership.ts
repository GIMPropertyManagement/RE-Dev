import { ENDPOINTS } from '@forge/gis';
import type { OwnershipPayload } from '../schemas.js';
import type { ResearchProducer } from '../types.js';
import { round, unresolvedResult } from './util.js';

const EMPTY: OwnershipPayload = {
  owner: null,
  use_code: null,
  lot_acres: null,
  assessed_total: null,
  land_val: null,
  fy: null,
  last_sale_date: null,
  last_sale_price: null,
  hold_years: null,
};

/**
 * Deterministic: read ownership/assessor from the MassGIS L3 attributes already
 * captured at parcel resolution — no scraping (the L3 layer carries the assessor
 * table). Annual snapshot: confidence is high but the FY is carried so downstream
 * never treats it as real-time.
 */
export const ownershipKind: ResearchProducer<OwnershipPayload> = async (input) => {
  const l3 = input.l3;
  if (!l3) return unresolvedResult('ownership', EMPTY);

  const lastSaleDate = l3.LS_DATE ?? null;
  const holdYears = lastSaleDate ? yearsSince(lastSaleDate) : null;

  return {
    kind: 'ownership',
    payload: {
      owner: l3.OWNER1 ?? null,
      use_code: l3.USE_CODE ?? null,
      lot_acres: l3.LOT_SIZE ?? input.lotAcres ?? null,
      assessed_total: l3.TOTAL_VAL ?? null,
      land_val: l3.LAND_VAL ?? null,
      fy: l3.FY ?? null,
      last_sale_date: lastSaleDate,
      last_sale_price: l3.LS_PRICE ?? null,
      hold_years: holdYears != null ? round(holdYears, 1) : null,
    },
    sources: [
      {
        title: `MassGIS L3 standardized assessor parcels${l3.FY ? ` (FY ${l3.FY})` : ''}`,
        url: `${ENDPOINTS.massgisL3Parcels.base}/${ENDPOINTS.massgisL3Parcels.layer}`,
        publisher: 'MassGIS',
      },
    ],
    confidence: 'high',
    needsHuman: false,
    needsHumanReasons: [],
  };
};

function yearsSince(dateish: string): number | null {
  const t = Date.parse(dateish);
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / (365.25 * 24 * 3600 * 1000);
}
