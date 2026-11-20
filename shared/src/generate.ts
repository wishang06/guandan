import {
  ACE,
  BIG_JOKER,
  NORMAL_RANKS,
  NORMAL_SUITS,
  SMALL_JOKER,
  cardPower,
  isWild,
  sortCards,
  type Card,
  type NormalSuit,
} from './cards';
import {
  beats,
  classifyResolved,
  comboStrength,
  getInterpretations,
  sequenceRanks,
  type Combo,
  type ComboKey,
  type WildUse,
} from './combos';

interface Requirement {
  rank: number;
  count: number;
  /** Required suit (straight flushes only). */
  suit?: NormalSuit;
}

/**
 * Generate every distinct play available from a hand (one representative per
 * type/size/rank, choosing the cheapest cards: fewest wilds, then lowest cards).
 * Results are sorted weakest → strongest.
 */
export function generatePlays(hand: readonly Card[], level: number): Combo[] {
  const wilds = hand.filter((c) => isWild(c, level));
  const byRank = new Map<number, Card[]>();
  for (const c of sortCards(hand, level)) {
    if (isWild(c, level)) continue;
    const list = byRank.get(c.rank) ?? [];
    list.push(c);
    byRank.set(c.rank, list);
  }
  const count = (r: number) => byRank.get(r)?.length ?? 0;
  const W = wilds.length;
  const found = new Map<string, { combo: Combo; cost: number }>();

  const add = (cards: Card[], uses: WildUse[]) => {
    const resolved = cards
      .filter((c) => !isWild(c, level))
      .map((c) => ({ rank: c.rank, suit: c.suit }))
      .concat(uses.map((u) => ({ rank: u.rank, suit: u.suit })));
    const cls = classifyResolved(resolved, level);
    if (!cls) return;
    const key = `${cls.type}:${cards.length}:${cls.rank}`;
    const cost = uses.length * 1000 + cards.reduce((s, c) => s + cardPower(c, level), 0);
    const prev = found.get(key);
    if (!prev || cost < prev.cost) {
      found.set(key, {
        cost,
        combo: { type: cls.type, rank: cls.rank, size: cards.length, cards: sortCards(cards, level), wilds: uses },
      });
    }
  };

  /** Pick cards for a list of requirements, filling gaps with wilds. */
  const build = (reqs: Requirement[], pick?: (pool: Card[], n: number) => Card[]) => {
    const cards: Card[] = [];
    const uses: WildUse[] = [];
    let w = 0;
    for (const req of reqs) {
      const all = byRank.get(req.rank) ?? [];
      const pool = req.suit ? all.filter((c) => c.suit === req.suit) : all;
      const take = pick ? pick(pool, req.count) : pool.slice(0, req.count);
      cards.push(...take);
      for (let k = take.length; k < req.count; k++) {
        if (w >= W) return null;
        const wild = wilds[w++]!;
        cards.push(wild);
        const suit: NormalSuit = req.suit ?? (req.rank === level ? 'H' : 'S');
        uses.push({ cardId: wild.id, rank: req.rank, suit });
      }
    }
    return { cards, uses };
  };

  const tryAdd = (reqs: Requirement[]) => {
    const b = build(reqs);
    if (b) add(b.cards, b.uses);
  };

  // Singles.
  for (const cards of byRank.values()) add([cards[0]!], []);
  if (W > 0) add([wilds[0]!], [{ cardId: wilds[0]!.id, rank: level, suit: 'H' }]);

  // Pairs, triples, bombs (n of a kind). All-wild groups only make sense as the level rank.
  for (const r of NORMAL_RANKS) {
    const c = count(r);
    if (c === 0 && r !== level) continue;
    if (c + W >= 2) tryAdd([{ rank: r, count: 2 }]);
    if (c + W >= 3) tryAdd([{ rank: r, count: 3 }]);
    for (let n = 4; n <= c + W; n++) tryAdd([{ rank: r, count: n }]);
  }
  for (const r of [SMALL_JOKER, BIG_JOKER]) if (count(r) >= 2) tryAdd([{ rank: r, count: 2 }]);
  if (count(SMALL_JOKER) === 2 && count(BIG_JOKER) === 2) {
    add([...byRank.get(SMALL_JOKER)!, ...byRank.get(BIG_JOKER)!], []);
  }

  // Full houses: triple + pair (pair may be identical jokers).
  for (const t of NORMAL_RANKS) {
    const ct = count(t);
    if ((ct === 0 && t !== level) || ct + W < 3) continue;
    for (const p of [...NORMAL_RANKS, SMALL_JOKER, BIG_JOKER]) {
      if (p === t) continue;
      const cp = count(p);
      if (p >= SMALL_JOKER && cp < 2) continue;
      if (cp === 0 && p !== level) continue;
      tryAdd([
        { rank: t, count: 3 },
        { rank: p, count: 2 },
      ]);
    }
  }

  // Straights (and straight flushes) of exactly five, A low or high.
  for (let top = 5; top <= ACE; top++) {
    const ranks = sequenceRanks(top, 5);
    // Plain straight: prefer mixing suits so we do not accidentally spend a straight flush.
    const used = new Map<string, number>();
    const b = build(
      ranks.map((rank) => ({ rank, count: 1 })),
      (pool, n) => {
        if (pool.length === 0 || n === 0) return [];
        const choice =
          [...pool].sort((x, y) => (used.get(x.suit) ?? 0) - (used.get(y.suit) ?? 0))[0]!;
        used.set(choice.suit, (used.get(choice.suit) ?? 0) + 1);
        return [choice];
      },
    );
    if (b) {
      // Give wild substitutes a suit that breaks the flush where possible.
      const naturalSuits = new Set(b.cards.filter((c) => !isWild(c, level)).map((c) => c.suit));
      const breaker = NORMAL_SUITS.find((s) => !naturalSuits.has(s)) ?? 'S';
      const uses = naturalSuits.size === 1 ? b.uses.map((u) => ({ ...u, suit: breaker })) : b.uses;
      add(b.cards, uses);
    }
    for (const suit of NORMAL_SUITS) tryAdd(ranks.map((rank) => ({ rank, count: 1, suit })));
  }

  // Tubes (3 consecutive pairs) and plates (2 consecutive triples).
  for (let top = 3; top <= ACE; top++) tryAdd(sequenceRanks(top, 3).map((rank) => ({ rank, count: 2 })));
  for (let top = 2; top <= ACE; top++) tryAdd(sequenceRanks(top, 2).map((rank) => ({ rank, count: 3 })));

  // Drop dominated readings of an identical card set (e.g. 3456+wild as 2-6 when it can
  // be 3-7, or as a plain straight when it can be a straight flush).
  const bySet = new Map<string, Combo[]>();
  for (const { combo } of found.values()) {
    const ids = combo.cards
      .map((c) => c.id)
      .sort((a, b) => a - b)
      .join(',');
    const list = bySet.get(ids) ?? [];
    list.push(combo);
    bySet.set(ids, list);
  }
  const out: Combo[] = [];
  for (const list of bySet.values()) {
    const hasFlush = list.some((c) => c.type === 'straightFlush');
    for (const c of list) {
      if (hasFlush && c.type === 'straight') continue;
      if (list.some((o) => o !== c && o.type === c.type && o.rank > c.rank)) continue;
      out.push(c);
    }
  }
  return out.sort((a, b) => comboStrength(a) - comboStrength(b) || a.size - b.size);
}

/**
 * The strongest default reading of a generated play's cards with the same type. A
 * generated play can be a dominated reading (S4–S7 + wild as 3–7 when it could be
 * 4–8); callers that are about to play it should upgrade first.
 */
export function strongestReading(play: Combo, level: number): Combo {
  if (play.wilds.length === 0) return play;
  const best = getInterpretations(play.cards, level).find((r) => r.type === play.type);
  return best && best.rank >= play.rank ? best : play;
}

/** All distinct plays that beat `current` (or every play when leading). */
export function generateLegalPlays(hand: readonly Card[], level: number, current: ComboKey | null): Combo[] {
  const all = generatePlays(hand, level);
  return current ? all.filter((c) => beats(c, current)) : all;
}
