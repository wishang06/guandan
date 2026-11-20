import { describe, expect, it } from 'vitest';
import { createDeck, isWild, type Card } from './cards';
import { getInterpretations, sameKey, type ComboKey } from './combos';
import { generateLegalPlays, generatePlays } from './generate';
import { shuffle } from './rng';
import { cards } from './test-utils';

function randomHand(seed: number, size: number): Card[] {
  return shuffle(createDeck(), seed)[0].slice(0, size);
}

const keyStr = (c: ComboKey) => `${c.type}:${c.size}:${c.rank}`;

function subsets<T>(items: T[], maxSize: number): T[][] {
  const out: T[][] = [];
  const rec = (start: number, acc: T[]) => {
    if (acc.length) out.push(acc.slice());
    if (acc.length === maxSize) return;
    for (let i = start; i < items.length; i++) {
      acc.push(items[i]!);
      rec(i + 1, acc);
      acc.pop();
    }
  };
  rec(0, []);
  return out;
}

describe('generatePlays', () => {
  it('every generated play is a valid reading of its own cards', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const level = 2 + (seed % 13);
      const hand = randomHand(seed, 27);
      const ids = new Set(hand.map((c) => c.id));
      for (const play of generatePlays(hand, level)) {
        expect(play.cards.every((c) => ids.has(c.id))).toBe(true);
        expect(new Set(play.cards.map((c) => c.id)).size).toBe(play.size);
        // Valid as an explicit choice…
        const all = getInterpretations(play.cards, level, { all: true });
        expect(all.some((r) => sameKey(r, play)), `${keyStr(play)} seed ${seed}`).toBe(true);
        // …and the default reading of the same cards is at least as strong.
        const best = getInterpretations(play.cards, level).find((r) => r.type === play.type);
        expect(best && best.rank >= play.rank, `${keyStr(play)} seed ${seed}`).toBe(true);
      }
    }
  });

  it('finds every combo that any subset of the hand can form (no wilds)', () => {
    for (let seed = 100; seed < 106; seed++) {
      const level = 9;
      const hand = randomHand(seed, 13).filter((c) => !isWild(c, level));
      const generated = new Set(generatePlays(hand, level).map(keyStr));
      for (const sub of subsets(hand, 6)) {
        for (const r of getInterpretations(sub, level)) expect(generated.has(keyStr(r)), keyStr(r)).toBe(true);
      }
    }
  });

  it('finds every combo that any subset can form, with wilds', () => {
    const level = 9;
    const hand = cards('H9 H9 S3 D3 S4 C5 D6 S7 JS');
    const generated = new Set(generatePlays(hand, level).map(keyStr));
    for (const sub of subsets(hand, 6)) {
      for (const r of getInterpretations(sub, level)) expect(generated.has(keyStr(r)), keyStr(r)).toBe(true);
    }
  });

  it('prefers natural cards over wilds', () => {
    const plays = generatePlays(cards('H5 S9 D9'), 5);
    const pair9 = plays.find((p) => p.type === 'pair' && p.rank === 9)!;
    expect(pair9.wilds).toHaveLength(0);
  });

  it('does not waste a straight flush when a plain straight is available', () => {
    const plays = generatePlays(cards('S3 S4 S5 S6 S7 D5'), 9);
    const straight = plays.find((p) => p.type === 'straight' && p.rank === 7);
    expect(straight).toBeDefined();
    expect(plays.some((p) => p.type === 'straightFlush' && p.rank === 7)).toBe(true);
  });

  it('attaches the cheapest pair to a full house', () => {
    const plays = generatePlays(cards('S9 D9 C9 S3 D3 SK DK'), 2);
    const fh = plays.find((p) => p.type === 'fullHouse' && p.rank === 9)!;
    expect(fh.cards.filter((c) => c.rank === 3)).toHaveLength(2);
  });

  it('filters to plays that beat the current combo', () => {
    const hand = cards('S3 D3 S8 D8 SK S4 D4 C4 H4');
    const legal = generateLegalPlays(hand, 2, { type: 'pair', rank: 7, size: 2 });
    expect(legal.map(keyStr)).toEqual(['pair:2:8', 'bomb:4:4']);
  });

  it('returns plays sorted weakest first with bombs last', () => {
    const plays = generatePlays(cards('S3 S9 D9 C9 H9 JB'), 2);
    expect(plays[0]).toMatchObject({ type: 'single', rank: 3 });
    expect(plays[plays.length - 1]).toMatchObject({ type: 'bomb', rank: 9 });
  });
});
