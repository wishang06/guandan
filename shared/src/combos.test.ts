import { describe, expect, it } from 'vitest';
import { beats, bombStrength, getInterpretations, type ComboKey } from './combos';
import { cards, kinds, one } from './test-utils';

const k = (type: ComboKey['type'], rank: number, size: number): ComboKey => ({ type, rank, size });

describe('basic combos', () => {
  it('single', () => {
    expect(one('S9')).toMatchObject({ type: 'single', rank: 9, size: 1 });
    expect(one('JB')).toMatchObject({ type: 'single', rank: 17 });
  });

  it('single level card ranks at level power', () => {
    expect(one('S5', 5)).toMatchObject({ type: 'single', rank: 15 });
  });

  it('pair', () => {
    expect(one('S9 D9')).toMatchObject({ type: 'pair', rank: 9, size: 2 });
    expect(one('JS JS')).toMatchObject({ type: 'pair', rank: 16 });
    expect(one('JB JB')).toMatchObject({ type: 'pair', rank: 17 });
  });

  it('mixed jokers are not a pair', () => {
    expect(kinds('JS JB')).toEqual([]);
  });

  it('triple', () => {
    expect(one('S9 D9 C9')).toMatchObject({ type: 'triple', rank: 9, size: 3 });
  });

  it('full house (triple + pair), ranked by the triple', () => {
    expect(one('S9 D9 C9 S4 D4')).toMatchObject({ type: 'fullHouse', rank: 9, size: 5 });
    expect(one('S3 D3 C3 SA DA')).toMatchObject({ type: 'fullHouse', rank: 3 });
  });

  it('full house may carry a pair of identical jokers', () => {
    expect(one('S9 D9 C9 JB JB')).toMatchObject({ type: 'fullHouse', rank: 9 });
    expect(kinds('S9 D9 C9 JS JB')).toEqual([]);
  });

  it('full house triple at level power', () => {
    expect(one('S5 D5 C5 S2 D2', 5)).toMatchObject({ type: 'fullHouse', rank: 15 });
  });

  it('rejects junk', () => {
    expect(kinds('S9 D8')).toEqual([]);
    expect(kinds('S9 D9 C8')).toEqual([]);
    expect(kinds('S9 D9 C9 S4 D5')).toEqual([]);
    expect(kinds('S9 D9 S8 D8')).toEqual([]); // two pairs is not a combo
    expect(kinds('S3 S4 S5 S6')).toEqual([]); // 4-card straight
    expect(kinds('S3 D4 S5 D6 S7 D8')).toEqual([]); // 6-card straight
  });
});

describe('straights (exactly 5)', () => {
  it('plain straight ranked by top card', () => {
    expect(one('S3 D4 C5 H6 S7')).toMatchObject({ type: 'straight', rank: 7, size: 5 });
  });

  it('A can be high', () => {
    expect(one('S10 DJ CQ HK SA')).toMatchObject({ type: 'straight', rank: 14 });
  });

  it('A can be low (A2345 is the lowest straight)', () => {
    expect(one('SA D2 C3 H4 S5')).toMatchObject({ type: 'straight', rank: 5 });
    expect(beats(one('S2 D3 C4 H5 S6'), one('SA D2 C3 H4 S5'))).toBe(true);
  });

  it('does not wrap around', () => {
    expect(kinds('SQ DK CA H2 S3')).toEqual([]);
    expect(kinds('SK DA C2 H3 S4')).toEqual([]);
  });

  it('level cards play at their natural rank inside a straight', () => {
    // Level 7: 5-6-7-8-9 is still a straight topped by 9.
    expect(one('S5 D6 C7 H8 S9', 7)).toMatchObject({ type: 'straight', rank: 9 });
  });

  it('jokers cannot be in a straight', () => {
    expect(kinds('S3 D4 C5 H6 JS')).toEqual([]);
  });
});

describe('tubes (3 consecutive pairs) and plates (2 consecutive triples)', () => {
  it('tube 木板', () => {
    expect(one('S3 D3 S4 D4 S5 D5')).toMatchObject({ type: 'tube', rank: 5, size: 6 });
  });

  it('tube with A high and A low', () => {
    expect(one('SQ DQ SK DK SA DA')).toMatchObject({ type: 'tube', rank: 14 });
    expect(one('SA DA S2 D2 S3 D3')).toMatchObject({ type: 'tube', rank: 3 });
  });

  it('non-consecutive pairs are not a tube', () => {
    expect(kinds('S3 D3 S4 D4 S6 D6')).toEqual([]);
    expect(kinds('SK DK SA DA S2 D2')).toEqual([]);
  });

  it('plate 钢板', () => {
    expect(one('S3 D3 C3 S4 D4 C4')).toMatchObject({ type: 'plate', rank: 4, size: 6 });
  });

  it('plate with A high and A low', () => {
    expect(one('SK DK CK SA DA CA')).toMatchObject({ type: 'plate', rank: 14 });
    expect(one('SA DA CA S2 D2 C2')).toMatchObject({ type: 'plate', rank: 2 });
  });

  it('non-consecutive triples are not a plate', () => {
    expect(kinds('S3 D3 C3 S5 D5 C5')).toEqual([]);
  });

  it('sequences use natural ranks even for the level rank', () => {
    expect(one('S6 D6 S7 D7 S8 D8', 7)).toMatchObject({ type: 'tube', rank: 8 });
  });
});

describe('bombs', () => {
  it('4 to 8 of a kind', () => {
    expect(one('S9 D9 C9 H9')).toMatchObject({ type: 'bomb', rank: 9, size: 4 });
    expect(one('S9 D9 C9 H9 S9')).toMatchObject({ type: 'bomb', size: 5 });
    expect(one('S9 D9 C9 H9 S9 D9 C9 H9')).toMatchObject({ type: 'bomb', size: 8 });
  });

  it('straight flush', () => {
    expect(one('S3 S4 S5 S6 S7')).toMatchObject({ type: 'straightFlush', rank: 7, size: 5 });
    expect(one('DA D2 D3 D4 D5')).toMatchObject({ type: 'straightFlush', rank: 5 });
  });

  it('four jokers (天王炸)', () => {
    expect(one('JS JS JB JB')).toMatchObject({ type: 'jokerBomb', size: 4 });
    expect(kinds('JS JS JB')).toEqual([]);
  });

  it('orders 4 < 5 < straight flush < 6 < 7 < 8 < jokers', () => {
    const ladder = [
      one('S2 D2 C2 H2', 9),
      one('SA DA CA HA', 9),
      one('S2 D2 C2 H2 S2', 9),
      one('SA DA CA HA SA', 9),
      one('S2 S3 S4 S5 SA', 9), // A2345 SF (lowest)
      one('S10 SJ SQ SK SA', 9), // royal SF
      one('S2 D2 C2 H2 S2 D2', 9),
      one('S2 D2 C2 H2 S2 D2 C2', 9),
      one('S2 D2 C2 H2 S2 D2 C2 H2', 9),
      one('JS JS JB JB', 9),
    ];
    for (let i = 0; i < ladder.length; i++) {
      for (let j = 0; j < ladder.length; j++) {
        expect(beats(ladder[i]!, ladder[j]!), `${i} vs ${j}`).toBe(i > j);
      }
    }
  });

  it('level-rank 4-bomb beats an A 4-bomb but loses to any 5-bomb', () => {
    const levelBomb = one('S5 D5 C5 S5', 5);
    expect(levelBomb.rank).toBe(15);
    expect(beats(levelBomb, one('SA DA CA HA', 5))).toBe(true);
    expect(beats(one('S2 D2 C2 H2 S2', 5), levelBomb)).toBe(true);
  });

  it('bomb strengths are monotone in size beyond 6', () => {
    expect(bombStrength(k('bomb', 2, 9))).toBeGreaterThan(bombStrength(k('bomb', 15, 8)));
    expect(bombStrength(k('bomb', 2, 10))).toBeGreaterThan(bombStrength(k('bomb', 15, 9)));
    expect(bombStrength(k('jokerBomb', 17, 4))).toBeGreaterThan(bombStrength(k('bomb', 15, 10)));
  });
});

describe('beats', () => {
  it('requires the same shape and a higher rank', () => {
    expect(beats(k('pair', 9, 2), k('pair', 8, 2))).toBe(true);
    expect(beats(k('pair', 8, 2), k('pair', 8, 2))).toBe(false);
    expect(beats(k('pair', 7, 2), k('pair', 8, 2))).toBe(false);
    expect(beats(k('triple', 9, 3), k('pair', 8, 2))).toBe(false);
    expect(beats(k('straight', 9, 5), k('fullHouse', 3, 5))).toBe(false);
    expect(beats(k('tube', 9, 6), k('plate', 3, 6))).toBe(false);
  });

  it('any bomb beats any non-bomb; non-bombs never beat bombs', () => {
    const bomb = k('bomb', 2, 4);
    for (const t of ['single', 'pair', 'triple', 'fullHouse', 'straight', 'tube', 'plate'] as const) {
      expect(beats(bomb, k(t, 17, 6))).toBe(true);
      expect(beats(k(t, 17, 6), bomb)).toBe(false);
    }
    expect(beats(k('straightFlush', 5, 5), k('straight', 14, 5))).toBe(true);
  });

  it('a straight flush is a bomb, not just a high straight', () => {
    const sf = one('S3 S4 S5 S6 S7');
    expect(beats(sf, one('S10 DJ CQ HK SA'))).toBe(true);
    expect(getInterpretations(cards('S3 S4 S5 S6 S7'), 2)).toHaveLength(1);
  });
});
