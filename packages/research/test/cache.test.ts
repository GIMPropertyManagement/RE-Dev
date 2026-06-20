import { describe, expect, it } from 'vitest';
import { computeStaleAfter, shouldRegenerate } from '../src/cache.js';

const NOW = Date.parse('2026-06-20T00:00:00Z');

describe('shouldRegenerate', () => {
  it('regenerates when no cache exists', () => {
    expect(shouldRegenerate('zoning', null, { now: NOW })).toBe(true);
  });

  it('keeps a fresh cache', () => {
    const staleAfter = new Date(NOW + 10 * 86400_000).toISOString();
    expect(shouldRegenerate('zoning', { generatedAt: '', staleAfter }, { now: NOW })).toBe(false);
  });

  it('regenerates a past-TTL cache', () => {
    const staleAfter = new Date(NOW - 86400_000).toISOString();
    expect(shouldRegenerate('zoning', { generatedAt: '', staleAfter }, { now: NOW })).toBe(true);
  });

  it('busts CMA on a material change but not zoning', () => {
    const staleAfter = new Date(NOW + 10 * 86400_000).toISOString();
    const fresh = { generatedAt: '', staleAfter };
    expect(shouldRegenerate('cma', fresh, { now: NOW, materialChange: true })).toBe(true);
    expect(shouldRegenerate('zoning', fresh, { now: NOW, materialChange: true })).toBe(false);
  });
});

describe('computeStaleAfter', () => {
  it('uses the per-kind TTL', () => {
    expect(computeStaleAfter('cma', NOW)).toBe(new Date(NOW + 21 * 86400_000).toISOString());
    expect(computeStaleAfter('zoning', NOW)).toBe(new Date(NOW + 180 * 86400_000).toISOString());
  });
  it('returns null for no-clock kinds (feasibility)', () => {
    expect(computeStaleAfter('feasibility', NOW)).toBeNull();
  });
});
