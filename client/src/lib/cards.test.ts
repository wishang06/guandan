import { describe, expect, it } from 'vitest';
import { getInterpretations, makeCardFactory, makeCards } from '@guandan/shared';
import { describeCombo, displayCards, groupHand } from './cards';
import { translate } from '../i18n';

const cards = (s: string) => makeCards(s, makeCardFactory());
const t = (k: Parameters<typeof translate>[1], v?: Record<string, string | number>) => translate('en', k, v);

describe('groupHand', () => {
  it('sorts ranks by power and groups bombs on the right with wilds last', () => {
    const groups = groupHand(cards('S9 D9 C9 H9 S3 HA S5 H5 JB D4'), 5);
    expect(groups.map((g) => g.key)).toEqual(['r3', 'r4', 'r14', 'r5', 'r17', 'r9', 'wild']);
    expect(groups.find((g) => g.key === 'r9')!.bomb).toBe(true);
  });

  it('groups four jokers as a bomb', () => {
    const groups = groupHand(cards('JS JS JB JB S3'), 2);
    expect(groups.map((g) => g.key)).toEqual(['r3', 'jokers']);
  });
});

describe('describeCombo', () => {
  it('names sequences by their range and kinds by rank', () => {
    expect(describeCombo({ type: 'straight', rank: 5, size: 5 }, 2, t)).toBe('Straight A–5');
    expect(describeCombo({ type: 'tube', rank: 14, size: 6 }, 2, t)).toBe('Three pairs Q–A');
    expect(describeCombo({ type: 'pair', rank: 15, size: 2 }, 7, t)).toBe('Pair 7');
    expect(describeCombo({ type: 'bomb', rank: 9, size: 5 }, 2, t)).toBe('5-card bomb 9');
  });
});

describe('displayCards', () => {
  it('shows A-low runs starting with the ace and wilds in their slot', () => {
    const [c] = getInterpretations(cards('S3 D4 C5 HA H9'), 9); // wild H9 fills the 2
    expect(displayCards(c!).map((x) => x.rank)).toEqual([14, 9, 3, 4, 5]);
  });

  it('puts the triple first in a full house', () => {
    const [c] = getInterpretations(cards('S3 D3 S9 D9 C9'), 2);
    expect(displayCards(c!).map((x) => x.rank)).toEqual([9, 9, 9, 3, 3]);
  });
});
