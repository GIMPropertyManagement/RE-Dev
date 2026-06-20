import { describe, expect, it } from 'vitest';
import type { ParcelRow } from '@forge/db';
import { buildDigest } from '../src/notify.js';

function row(over: Partial<ParcelRow>): ParcelRow {
  return {
    parcel_id: 'p',
    loc_id: null,
    resolution: 'l3',
    address: '33 Russo Dr',
    city: 'Hopkinton',
    zip: null,
    mls_listing_key: 'k',
    standard_status: 'Active',
    property_type: 'Land',
    list_price: 250000,
    lot_acres: 1.5,
    modification_ts: '2025-04-16',
    score: 82,
    rank: 1,
    profit_mid: 168000,
    flags: [{ code: 'frontage_variance' }],
    summary: null,
    ...over,
  };
}

describe('buildDigest', () => {
  it('renders a ranked top-N digest', () => {
    const { subject, text } = buildDigest([row({}), row({ score: 54, address: '12 Elm St', flags: [] })], '2026-06-20');
    expect(subject).toContain('top 2');
    expect(subject).toContain('2026-06-20');
    expect(text).toContain('1. [82] 33 Russo Dr');
    expect(text).toContain('profit $168,000');
    expect(text).toContain('frontage_variance');
    expect(text).toContain('2. [54] 12 Elm St');
    expect(text).toContain('no flags');
  });
});
