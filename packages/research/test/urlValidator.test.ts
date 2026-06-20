import { describe, expect, it } from 'vitest';
import { isAllowedHost, validateSources } from '../src/urlValidator.js';

describe('isAllowedHost', () => {
  it('allows government + ordinance-publisher hosts', () => {
    expect(isAllowedHost('hazards.fema.gov')).toBe(true);
    expect(isAllowedHost('arcgisserver.digital.mass.gov')).toBe(true);
    expect(isAllowedHost('www.town.natick.ma.us')).toBe(true);
    expect(isAllowedHost('ecode360.com')).toBe(true);
    expect(isAllowedHost('library.municode.com')).toBe(true);
  });
  it('rejects arbitrary hosts', () => {
    expect(isAllowedHost('example.com')).toBe(false);
    expect(isAllowedHost('totally-real-zoning.io')).toBe(false);
    expect(isAllowedHost('fema.gov.evil.com')).toBe(false);
  });
});

describe('validateSources', () => {
  it('drops non-allowlisted hosts and bad URLs', async () => {
    const { valid, dropped } = await validateSources([
      { title: 'gov', url: 'https://www.hopkintonma.gov/zoning.pdf' },
      { title: 'bad host', url: 'https://blog.example.com/zoning' },
      { title: 'garbage', url: 'not a url' },
    ]);
    expect(valid.map((v) => v.title)).toEqual(['gov']);
    expect(dropped.map((d) => d.reason).sort()).toEqual(['bad_url', 'host_not_allowed']);
  });

  it('enforces "fetched this turn" when seenUrls is provided', async () => {
    const seenUrls = new Set(['https://www.hopkintonma.gov/zoning.pdf']);
    const { valid, dropped } = await validateSources(
      [
        { title: 'seen', url: 'https://www.hopkintonma.gov/zoning.pdf' },
        { title: 'unseen gov', url: 'https://www.hopkintonma.gov/other.pdf' },
      ],
      { seenUrls },
    );
    expect(valid).toHaveLength(1);
    expect(dropped[0].reason).toBe('not_fetched_this_turn');
  });
});
