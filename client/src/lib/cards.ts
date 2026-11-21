import {
  BIG_JOKER,
  SMALL_JOKER,
  SUIT_SYMBOL,
  cardPower,
  isWild,
  rankLabel,
  sequenceRanks,
  sortCards,
  type Card,
  type Combo,
  type ComboKey,
} from '@guandan/shared';
import type { Translate } from '../i18n';

export interface HandGroup {
  key: string;
  cards: Card[];
  bomb: boolean;
}

/**
 * Display order for a hand: ranks ascending by power; bombs (4+ of a rank, or the
 * four jokers) are pulled out and grouped on the right; wild hearts go last.
 */
export function groupHand(hand: readonly Card[], level: number): HandGroup[] {
  const sorted = sortCards(hand, level);
  const wilds = sorted.filter((c) => isWild(c, level));
  const byRank = new Map<number, Card[]>();
  for (const c of sorted) {
    if (isWild(c, level)) continue;
    const list = byRank.get(c.rank) ?? [];
    list.push(c);
    byRank.set(c.rank, list);
  }
  const normal: HandGroup[] = [];
  const bombs: HandGroup[] = [];
  const jokers = [...(byRank.get(SMALL_JOKER) ?? []), ...(byRank.get(BIG_JOKER) ?? [])];
  const jokerBomb = jokers.length === 4;
  for (const [rank, cards] of byRank) {
    if (jokerBomb && rank >= SMALL_JOKER) continue;
    const g = { key: `r${rank}`, cards, bomb: cards.length >= 4 };
    (g.bomb ? bombs : normal).push(g);
  }
  normal.sort((a, b) => cardPower(a.cards[0]!, level) - cardPower(b.cards[0]!, level));
  bombs.sort(
    (a, b) => a.cards.length - b.cards.length || cardPower(a.cards[0]!, level) - cardPower(b.cards[0]!, level),
  );
  if (jokerBomb) bombs.push({ key: 'jokers', cards: jokers, bomb: true });
  const groups = [...normal, ...bombs];
  if (wilds.length) groups.push({ key: 'wild', cards: wilds, bomb: false });
  return groups;
}

export function isRed(card: Card): boolean {
  return card.suit === 'H' || card.suit === 'D' || card.rank === BIG_JOKER;
}

export function cardText(card: Card, lang: 'en' | 'zh'): string {
  if (card.rank === SMALL_JOKER) return lang === 'zh' ? '小王' : 'small joker';
  if (card.rank === BIG_JOKER) return lang === 'zh' ? '大王' : 'big joker';
  return `${SUIT_SYMBOL[card.suit]}${rankLabel(card.rank)}`;
}

/** Human description of a combo, e.g. "Straight 3–7" or "炸弹 9 ×5". */
export function describeCombo(c: ComboKey, level: number, t: Translate): string {
  const name = t(`combo_${c.type}` as never, { n: c.size });
  const r = (rank: number) => (rank === 15 ? rankLabel(level) : rankLabel(rank));
  switch (c.type) {
    case 'straight':
    case 'straightFlush': {
      const ranks = sequenceRanks(c.rank, 5);
      return `${name} ${rankLabel(ranks[0]!)}–${rankLabel(ranks[4]!)}`;
    }
    case 'tube': {
      const ranks = sequenceRanks(c.rank, 3);
      return `${name} ${rankLabel(ranks[0]!)}–${rankLabel(ranks[2]!)}`;
    }
    case 'plate': {
      const ranks = sequenceRanks(c.rank, 2);
      return `${name} ${rankLabel(ranks[0]!)}–${rankLabel(ranks[1]!)}`;
    }
    case 'jokerBomb':
      return name;
    default:
      return `${name} ${r(c.rank)}`;
  }
}

/**
 * Order a played combo's cards for display: sequences in run order (A low when the
 * run is A-2-3…), full houses triple-first, everything else as dealt.
 */
export function displayCards(combo: Combo): Card[] {
  const wildRank = new Map(combo.wilds.map((w) => [w.cardId, w.rank]));
  const eff = (c: Card) => wildRank.get(c.id) ?? c.rank;
  switch (combo.type) {
    case 'straight':
    case 'straightFlush':
    case 'tube':
    case 'plate': {
      const pos = (c: Card) => (eff(c) === 14 && combo.rank < 14 ? 1 : eff(c));
      return [...combo.cards].sort((a, b) => pos(a) - pos(b) || a.id - b.id);
    }
    case 'fullHouse': {
      const counts = new Map<number, number>();
      for (const c of combo.cards) counts.set(eff(c), (counts.get(eff(c)) ?? 0) + 1);
      return [...combo.cards].sort((a, b) => counts.get(eff(b))! - counts.get(eff(a))! || a.id - b.id);
    }
    default:
      return combo.cards;
  }
}
