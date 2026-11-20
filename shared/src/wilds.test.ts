import { describe, expect, it } from 'vitest';
import { getInterpretations, getLegalInterpretations, type ComboKey } from './combos';
import { cards, kinds, one } from './test-utils';

// Level 5 unless stated: H5 is the wild (逢人配).
describe('wild card (红心级牌)', () => {
  it('alone is a single level card', () => {
    expect(one('H5', 5)).toMatchObject({ type: 'single', rank: 15 });
  });

  it('pairs with any non-joker card', () => {
    expect(one('H5 S9', 5)).toMatchObject({ type: 'pair', rank: 9 });
    expect(one('H5 SA', 5)).toMatchObject({ type: 'pair', rank: 14 });
    expect(one('H5 S5', 5)).toMatchObject({ type: 'pair', rank: 15 });
  });

  it('two wilds are a pair of level cards', () => {
    expect(one('H5 H5', 5)).toMatchObject({ type: 'pair', rank: 15 });
  });

  it('never substitutes for a joker', () => {
    expect(kinds('H5 JB', 5)).toEqual([]);
    expect(kinds('H5 JS JS', 5)).toEqual([]);
    expect(kinds('H5 JS JS JB', 5)).toEqual([]); // no joker bomb from a wild
    expect(kinds('H5 H5 JS JB', 5)).toEqual([]);
  });

  it('completes a triple and a bomb', () => {
    expect(one('H5 S9 D9', 5)).toMatchObject({ type: 'triple', rank: 9 });
    expect(one('H5 S9 D9 C9', 5)).toMatchObject({ type: 'bomb', rank: 9, size: 4 });
    expect(one('H5 H5 S9 D9 C9 H9', 5)).toMatchObject({ type: 'bomb', rank: 9, size: 6 });
  });

  it('extends a bomb up to 10 cards', () => {
    expect(one('H5 H5 S9 S9 D9 D9 C9 C9 H9 H9', 5)).toMatchObject({ type: 'bomb', size: 10 });
  });

  it('completes a full house, keeping the strongest triple', () => {
    // wild + 99 + 44 can be 999+44 or 444+99: only the stronger reading is offered.
    expect(kinds('H5 S9 D9 S4 D4', 5)).toEqual(['fullHouse:9']);
  });

  it('fills a gap in a straight', () => {
    expect(one('S3 D4 C6 S7 H9', 9)).toMatchObject({ type: 'straight', rank: 7 });
  });

  it('extends a straight at the top end (strongest reading)', () => {
    // 3456 + wild is 34567, not 23456.
    expect(kinds('S3 D4 C5 S6 H9', 9)).toEqual(['straight:7']);
  });

  it('can be used as itself inside a straight', () => {
    expect(one('S7 D8 H9 C10 SJ', 9)).toMatchObject({ type: 'straight', rank: 11 });
  });

  it('completes a straight flush (which supersedes the plain straight)', () => {
    expect(kinds('S3 S4 S6 S7 H9', 9)).toEqual(['straightFlush:7']);
  });

  it('completes tubes and plates', () => {
    expect(one('S3 D3 S4 D4 S5 H9', 9)).toMatchObject({ type: 'tube', rank: 5 });
    expect(one('S3 D3 C3 S4 D4 H9', 9)).toMatchObject({ type: 'plate', rank: 4 });
  });

  it('offers every distinct shape when the cards are ambiguous', () => {
    // Two wilds + 33 44: tube 334455 or plate 333444.
    expect(kinds('H9 H9 S3 D3 S4 D4', 9).sort()).toEqual(['plate:4', 'tube:5']);
    // Two wilds + 999: full house 999+(wild pair) or a 5-bomb of 9s.
    expect(kinds('H5 H5 S9 D9 C9', 5)).toEqual(['bomb:9', 'fullHouse:9']);
  });

  it('only offers readings that beat the current play when following', () => {
    const current: ComboKey = { type: 'fullHouse', rank: 10, size: 5 };
    const legal = getLegalInterpretations(cards('H5 H5 S9 D9 C9'), 5, current);
    expect(legal.map((c) => c.type)).toEqual(['bomb']);
  });

  it('records how each wild was used', () => {
    const [combo] = getInterpretations(cards('S3 D4 C6 S7 H9'), 9);
    expect(combo!.wilds).toHaveLength(1);
    expect(combo!.wilds[0]!.rank).toBe(5);
  });

  it('works at level A', () => {
    expect(one('HA S9', 14)).toMatchObject({ type: 'pair', rank: 9 });
    expect(one('HA SA', 14)).toMatchObject({ type: 'pair', rank: 15 });
    expect(one('S10 DJ CQ HK HA', 14)).toMatchObject({ type: 'straight', rank: 14 });
  });

  it('the all option exposes dominated readings for validation', () => {
    const all = getInterpretations(cards('H5 H5'), 5, { all: true });
    expect(all.length).toBe(13);
    expect(all.every((c) => c.type === 'pair')).toBe(true);
  });
});
