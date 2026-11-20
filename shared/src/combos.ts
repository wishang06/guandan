import {
  ACE,
  BIG_JOKER,
  NORMAL_RANKS,
  NORMAL_SUITS,
  SMALL_JOKER,
  isWild,
  rankPower,
  sortCards,
  type Card,
  type NormalSuit,
  type Suit,
} from './cards';

export type ComboType =
  | 'single'
  | 'pair'
  | 'triple'
  | 'fullHouse' // 三带二
  | 'straight' // 顺子 (exactly 5)
  | 'tube' // 木板 / 三连对 (3 consecutive pairs)
  | 'plate' // 钢板 (2 consecutive triples)
  | 'bomb' // 4+ of a kind
  | 'straightFlush' // 同花顺
  | 'jokerBomb'; // 天王炸 (4 jokers)

export const BOMB_TYPES: ReadonlySet<ComboType> = new Set<ComboType>(['bomb', 'straightFlush', 'jokerBomb']);

/** How a wild card (红心级牌) was used inside a combo. */
export interface WildUse {
  cardId: number;
  rank: number;
  suit: NormalSuit;
}

export interface Combo {
  type: ComboType;
  /**
   * Comparison key within the type: the power of the repeated rank for kind-based
   * combos (single, pair, triple, full house's triple, bomb), or the top natural rank
   * for sequences (A-low straight has top 5).
   */
  rank: number;
  /** Number of cards. */
  size: number;
  cards: Card[];
  wilds: WildUse[];
}

/** Identifies one interpretation of a set of cards (used to disambiguate wild plays). */
export interface ComboKey {
  type: ComboType;
  rank: number;
  size: number;
}

export function comboKey(c: ComboKey): ComboKey {
  return { type: c.type, rank: c.rank, size: c.size };
}

export function sameKey(a: ComboKey, b: ComboKey): boolean {
  return a.type === b.type && a.rank === b.rank && a.size === b.size;
}

export function isBomb(c: Pick<ComboKey, 'type'>): boolean {
  return BOMB_TYPES.has(c.type);
}

/**
 * Global bomb ordering:
 * 4-of-a-kind < 5-of-a-kind < straight flush < 6 < 7 < 8 < 9 < 10-of-a-kind < 4 jokers.
 */
export function bombStrength(c: ComboKey): number {
  switch (c.type) {
    case 'jokerBomb':
      return 10_000;
    case 'straightFlush':
      return 300 + c.rank;
    case 'bomb': {
      const tier = c.size <= 5 ? c.size - 3 : c.size - 2; // 4→1, 5→2, 6→4, 7→5, ...
      return tier * 100 + c.rank;
    }
    default:
      return -1;
  }
}

/** Does `a` beat `b` (the combo currently on the table)? */
export function beats(a: ComboKey, b: ComboKey): boolean {
  const ab = isBomb(a);
  const bb = isBomb(b);
  if (ab && !bb) return true;
  if (!ab && bb) return false;
  if (ab && bb) return bombStrength(a) > bombStrength(b);
  return a.type === b.type && a.size === b.size && a.rank > b.rank;
}

/** Total order used to sort plays from weakest to strongest (for hints / bots / display). */
export function comboStrength(c: ComboKey): number {
  if (isBomb(c)) return 100_000 + bombStrength(c);
  return c.rank;
}

interface ResolvedCard {
  rank: number;
  suit: Suit;
}

function isConsecutive(sortedAsc: number[]): boolean {
  for (let i = 1; i < sortedAsc.length; i++) {
    if (sortedAsc[i] !== sortedAsc[i - 1]! + 1) return false;
  }
  return true;
}

/**
 * Top rank of a run of distinct natural ranks, letting A be high (14) or low (1).
 * Returns null if the ranks are not consecutive. Runs never wrap (no Q-K-A-2-3).
 */
export function sequenceTop(ranks: readonly number[]): number | null {
  const asc = [...ranks].sort((a, b) => a - b);
  if (asc.some((r) => r > ACE || r < 2)) return null;
  if (isConsecutive(asc)) return asc[asc.length - 1]!;
  if (asc.includes(ACE)) {
    const low = asc.map((r) => (r === ACE ? 1 : r)).sort((a, b) => a - b);
    if (isConsecutive(low)) return low[low.length - 1]!;
  }
  return null;
}

/** Ranks of a run of `length` ending at `top` (1 is mapped back to A). */
export function sequenceRanks(top: number, length: number): number[] {
  const out: number[] = [];
  for (let r = top - length + 1; r <= top; r++) out.push(r === 1 ? ACE : r);
  return out;
}

/**
 * Classify fully-resolved cards (wilds already substituted). Level cards play at
 * natural rank inside sequences and at level power in kind-based combos.
 */
export function classifyResolved(
  cards: readonly ResolvedCard[],
  level: number,
): { type: ComboType; rank: number } | null {
  const n = cards.length;
  if (n === 0) return null;
  const counts = new Map<number, number>();
  for (const c of cards) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  const sj = counts.get(SMALL_JOKER) ?? 0;
  const bj = counts.get(BIG_JOKER) ?? 0;

  if (n === 4 && sj === 2 && bj === 2) return { type: 'jokerBomb', rank: BIG_JOKER };
  if (n === 1) return { type: 'single', rank: rankPower(cards[0]!.rank, level) };

  if (counts.size === 1) {
    const r = cards[0]!.rank;
    const p = rankPower(r, level);
    if (n === 2) return { type: 'pair', rank: p };
    if (n === 3) return { type: 'triple', rank: p };
    if (r < SMALL_JOKER) return { type: 'bomb', rank: p };
    return null;
  }

  if (n === 5 && counts.size === 2) {
    let tripleRank: number | undefined;
    let pairRank: number | undefined;
    for (const [r, c] of counts) {
      if (c === 3) tripleRank = r;
      else if (c === 2) pairRank = r;
    }
    // The pair may be two identical jokers; the triple can never be jokers.
    if (tripleRank !== undefined && pairRank !== undefined && tripleRank < SMALL_JOKER) {
      return { type: 'fullHouse', rank: rankPower(tripleRank, level) };
    }
    return null;
  }

  if (sj + bj > 0) return null; // jokers cannot appear in sequences

  const ranks = [...counts.keys()];
  const values = [...counts.values()];
  if (n === 5 && counts.size === 5) {
    const top = sequenceTop(ranks);
    if (top === null) return null;
    const flush = cards.every((c) => c.suit === cards[0]!.suit);
    return { type: flush ? 'straightFlush' : 'straight', rank: top };
  }
  if (n === 6 && counts.size === 3 && values.every((v) => v === 2)) {
    const top = sequenceTop(ranks);
    return top === null ? null : { type: 'tube', rank: top };
  }
  if (n === 6 && counts.size === 2 && values.every((v) => v === 3)) {
    const top = sequenceTop(ranks);
    return top === null ? null : { type: 'plate', rank: top };
  }
  return null;
}

/** Every rank/suit a wild may stand in for (never a joker). */
const WILD_OPTIONS: { rank: number; suit: NormalSuit }[] = NORMAL_RANKS.flatMap((rank) =>
  NORMAL_SUITS.map((suit) => ({ rank, suit })),
);

function byStrengthDesc(a: ComboKey, b: ComboKey): number {
  return comboStrength(b) - comboStrength(a);
}

export interface InterpretOptions {
  /**
   * Keep every distinct reading instead of only the useful ones. Used to validate an
   * explicit choice sent by a client or bot.
   */
  all?: boolean;
}

/**
 * Enumerate every legal interpretation of the selected cards.
 *
 * Without wilds there is at most one. With wilds every substitution is tried. By
 * default dominated readings are pruned: for each shape (type + size) only the
 * strongest is kept, and a plain straight is dropped when the same cards can be a
 * straight flush (a natural same-suit straight is always a bomb too). Shapes can still
 * differ (e.g. two wilds + 33 44 is a tube 334455 or a plate 333444), so the caller may
 * need to ask the player which one they meant.
 */
export function getInterpretations(cards: readonly Card[], level: number, opts: InterpretOptions = {}): Combo[] {
  if (cards.length === 0) return [];
  if (new Set(cards.map((c) => c.id)).size !== cards.length) return [];

  const wilds = cards.filter((c) => isWild(c, level));
  const naturals: ResolvedCard[] = cards
    .filter((c) => !isWild(c, level))
    .map((c) => ({ rank: c.rank, suit: c.suit }));
  const sorted = sortCards(cards, level);
  const best = new Map<string, Combo>();
  const asItself = (uses: WildUse[]) => uses.filter((u) => u.rank === level && u.suit === 'H').length;

  const consider = (uses: WildUse[]) => {
    const resolved = uses.length ? naturals.concat(uses.map((u) => ({ rank: u.rank, suit: u.suit }))) : naturals;
    const cls = classifyResolved(resolved, level);
    if (!cls) return;
    const key = opts.all ? `${cls.type}:${cards.length}:${cls.rank}` : `${cls.type}:${cards.length}`;
    const prev = best.get(key);
    if (!prev || cls.rank > prev.rank || (cls.rank === prev.rank && asItself(uses) > asItself(prev.wilds))) {
      best.set(key, { type: cls.type, rank: cls.rank, size: cards.length, cards: sorted, wilds: uses });
    }
  };

  if (wilds.length === 0) {
    consider([]);
  } else if (wilds.length === 1) {
    for (const o of WILD_OPTIONS) consider([{ cardId: wilds[0]!.id, ...o }]);
  } else {
    // Two wilds are interchangeable, so only unordered pairs of substitutions are needed.
    for (let i = 0; i < WILD_OPTIONS.length; i++) {
      for (let j = i; j < WILD_OPTIONS.length; j++) {
        consider([
          { cardId: wilds[0]!.id, ...WILD_OPTIONS[i]! },
          { cardId: wilds[1]!.id, ...WILD_OPTIONS[j]! },
        ]);
      }
    }
  }
  let out = [...best.values()];
  if (!opts.all && out.some((c) => c.type === 'straightFlush')) out = out.filter((c) => c.type !== 'straight');
  return out.sort(byStrengthDesc);
}

/** Interpretations of `cards` that are legal right now (beat `current` if following). */
export function getLegalInterpretations(
  cards: readonly Card[],
  level: number,
  current: ComboKey | null,
  opts: InterpretOptions = {},
): Combo[] {
  const all = getInterpretations(cards, level, opts);
  return current ? all.filter((c) => beats(c, current)) : all;
}
