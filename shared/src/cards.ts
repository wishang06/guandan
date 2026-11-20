/**
 * Card model for Guandan: two standard 52-card decks plus four jokers (108 cards).
 *
 * Natural ranks: 2..10, J=11, Q=12, K=13, A=14, small joker=16, big joker=17.
 * "Power" is the rank used to compare singles / pairs / triples / bombs once the
 * current level is known: the level rank is lifted to 15 (just below the jokers).
 */

export type Suit = 'S' | 'H' | 'C' | 'D' | 'J';
export const NORMAL_SUITS = ['S', 'H', 'C', 'D'] as const;
export type NormalSuit = (typeof NORMAL_SUITS)[number];

export const JACK = 11;
export const QUEEN = 12;
export const KING = 13;
export const ACE = 14;
/** Power of a level card (级牌) — above A, below jokers. */
export const LEVEL_POWER = 15;
export const SMALL_JOKER = 16;
export const BIG_JOKER = 17;

/** Natural non-joker ranks in ascending order. */
export const NORMAL_RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, JACK, QUEEN, KING, ACE] as const;

export interface Card {
  /** Unique id 0..107 — stable across the whole match. */
  id: number;
  suit: Suit;
  rank: number;
}

export function isJoker(card: Pick<Card, 'rank'>): boolean {
  return card.rank >= SMALL_JOKER;
}

/** The heart of the current level rank (红心级牌 / 逢人配) is wild. */
export function isWild(card: Pick<Card, 'rank' | 'suit'>, level: number): boolean {
  return card.suit === 'H' && card.rank === level;
}

/** Comparison power of a natural rank at the given level. */
export function rankPower(rank: number, level: number): number {
  if (rank >= SMALL_JOKER) return rank;
  if (rank === level) return LEVEL_POWER;
  return rank;
}

export function cardPower(card: Pick<Card, 'rank'>, level: number): number {
  return rankPower(card.rank, level);
}

/** Build the full 108-card deck in a fixed order (ids are indices). */
export function createDeck(): Card[] {
  const cards: Card[] = [];
  let id = 0;
  for (let deck = 0; deck < 2; deck++) {
    for (const suit of NORMAL_SUITS) {
      for (const rank of NORMAL_RANKS) {
        cards.push({ id: id++, suit, rank });
      }
    }
    cards.push({ id: id++, suit: 'J', rank: SMALL_JOKER });
    cards.push({ id: id++, suit: 'J', rank: BIG_JOKER });
  }
  return cards;
}

const SUIT_ORDER: Record<Suit, number> = { D: 0, C: 1, H: 2, S: 3, J: 4 };

/** Sort ascending by power, then suit, then id — the default hand order. */
export function sortCards(cards: readonly Card[], level: number): Card[] {
  return cards.slice().sort((a, b) => compareCards(a, b, level));
}

export function compareCards(a: Card, b: Card, level: number): number {
  const pa = cardPower(a, level);
  const pb = cardPower(b, level);
  if (pa !== pb) return pa - pb;
  // Wild hearts sort after the other level cards.
  const wa = isWild(a, level) ? 1 : 0;
  const wb = isWild(b, level) ? 1 : 0;
  if (wa !== wb) return wa - wb;
  if (a.suit !== b.suit) return SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
  return a.id - b.id;
}

export function rankLabel(rank: number): string {
  switch (rank) {
    case JACK:
      return 'J';
    case QUEEN:
      return 'Q';
    case KING:
      return 'K';
    case ACE:
    case 1:
      return 'A';
    case SMALL_JOKER:
      return 'SJ';
    case BIG_JOKER:
      return 'BJ';
    default:
      return String(rank);
  }
}

export const SUIT_SYMBOL: Record<Suit, string> = { S: '♠', H: '♥', C: '♣', D: '♦', J: '' };

export function cardLabel(card: Pick<Card, 'rank' | 'suit'>): string {
  if (card.rank === SMALL_JOKER) return 'SJ';
  if (card.rank === BIG_JOKER) return 'BJ';
  return `${SUIT_SYMBOL[card.suit]}${rankLabel(card.rank)}`;
}

/**
 * Parse a compact card spec for tests and tooling, e.g. "H5", "S10", "DA", "SJ" (jack of
 * spades), "JS" (small joker), "JB" (big joker).
 * Ids are taken from a deck so the same physical card is never produced twice.
 */
export function makeCardFactory() {
  const used = new Set<number>();
  const deck = createDeck();
  return function card(spec: string): Card {
    const s = spec.trim().toUpperCase();
    let suit: Suit;
    let rank: number;
    if (s === 'JS' || s === 'JB') {
      suit = 'J';
      rank = s === 'JS' ? SMALL_JOKER : BIG_JOKER;
    } else {
      suit = s[0] as Suit;
      if (!['S', 'H', 'C', 'D'].includes(suit)) throw new Error(`bad suit in ${spec}`);
      const r = s.slice(1);
      const map: Record<string, number> = { J: JACK, Q: QUEEN, K: KING, A: ACE };
      rank = map[r] ?? Number(r);
      if (!Number.isInteger(rank) || rank < 2 || rank > ACE) throw new Error(`bad rank in ${spec}`);
    }
    const found = deck.find((c) => c.suit === suit && c.rank === rank && !used.has(c.id));
    if (!found) throw new Error(`no more copies of ${spec}`);
    used.add(found.id);
    return { ...found };
  };
}

/** Convenience: build several cards from a space-separated spec string. */
export function makeCards(specs: string, factory = makeCardFactory()): Card[] {
  return specs
    .split(/\s+/)
    .filter(Boolean)
    .map((s) => factory(s));
}
