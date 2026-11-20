import { describe, expect, it } from 'vitest';
import {
  BIG_JOKER,
  LEVEL_POWER,
  SMALL_JOKER,
  cardPower,
  createDeck,
  isWild,
  rankPower,
  sortCards,
} from './cards';
import { createMatch } from './game';
import { cards } from './test-utils';

describe('deck', () => {
  it('has 108 unique cards: 2 decks + 4 jokers', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(108);
    expect(new Set(deck.map((c) => c.id)).size).toBe(108);
    for (let rank = 2; rank <= 14; rank++) {
      expect(deck.filter((c) => c.rank === rank)).toHaveLength(8);
    }
    expect(deck.filter((c) => c.rank === SMALL_JOKER)).toHaveLength(2);
    expect(deck.filter((c) => c.rank === BIG_JOKER)).toHaveLength(2);
  });

  it('deals 27 cards to each of 4 players', () => {
    const m = createMatch({ seed: 42 });
    expect(m.hand.hands.map((h) => h.length)).toEqual([27, 27, 27, 27]);
    const ids = m.hand.hands.flat().map((c) => c.id);
    expect(new Set(ids).size).toBe(108);
  });

  it('deals deterministically from a seed', () => {
    const a = createMatch({ seed: 7 });
    const b = createMatch({ seed: 7 });
    const c = createMatch({ seed: 8 });
    expect(a.hand.hands).toEqual(b.hand.hands);
    expect(a.hand.hands).not.toEqual(c.hand.hands);
  });
});

describe('rank power', () => {
  it('orders 2 < ... < A < level card < small joker < big joker', () => {
    const level = 7;
    expect(rankPower(2, level)).toBeLessThan(rankPower(3, level));
    expect(rankPower(13, level)).toBeLessThan(rankPower(14, level));
    expect(rankPower(7, level)).toBe(LEVEL_POWER);
    expect(rankPower(14, level)).toBeLessThan(rankPower(7, level));
    expect(rankPower(7, level)).toBeLessThan(rankPower(SMALL_JOKER, level));
    expect(rankPower(SMALL_JOKER, level)).toBeLessThan(rankPower(BIG_JOKER, level));
  });

  it('treats only the level-rank heart as wild', () => {
    const [h7, s7, h8] = cards('H7 S7 H8');
    expect(isWild(h7!, 7)).toBe(true);
    expect(isWild(s7!, 7)).toBe(false);
    expect(isWild(h8!, 7)).toBe(false);
    expect(cardPower(s7!, 7)).toBe(LEVEL_POWER);
  });

  it('sorts a hand by power with the level cards near the top', () => {
    const sorted = sortCards(cards('JB S5 HA D2 JS C5'), 5);
    expect(sorted.map((c) => c.rank)).toEqual([2, 14, 5, 5, SMALL_JOKER, BIG_JOKER]);
  });
});
