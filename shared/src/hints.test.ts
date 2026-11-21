import { describe, expect, it } from 'vitest';
import { suggestPlays } from './hints';
import { cards } from './test-utils';

describe('suggestPlays', () => {
  it('leads by shedding the lowest cards, preferring bigger combos at that rank', () => {
    const s = suggestPlays(cards('S3 D3 C3 S4 D4 SK S9 D9 C9 H9'), 2, null);
    expect(s[0]).toMatchObject({ type: 'fullHouse', rank: 3 });
    expect(s[s.length - 1]).toMatchObject({ type: 'bomb', rank: 9 });
  });

  it('follows with the lowest beating non-bomb, bombs last', () => {
    const s = suggestPlays(cards('S5 SK SA S9 D9 C9 H9'), 2, { type: 'single', rank: 10, size: 1 });
    expect(s.map((c) => `${c.type}:${c.rank}`)).toEqual(['single:13', 'single:14', 'bomb:9']);
  });

  it('returns nothing when nothing beats the table', () => {
    expect(suggestPlays(cards('S3 S4'), 2, { type: 'pair', rank: 9, size: 2 })).toEqual([]);
  });
});
