import { NORMAL_RANKS, SMALL_JOKER, BIG_JOKER, cardPower, isJoker, isWild, type Card } from './cards';
import { bombStrength, comboStrength, isBomb, type Combo } from './combos';
import {
  partnerOf,
  pendingSeats,
  returnCandidates,
  teamOf,
  timeoutAction,
  type Action,
  type MatchState,
  type Seat,
} from './game';
import { generateLegalPlays, strongestReading } from './generate';
import { comboFloor } from './hints';

/** An opponent with this many cards or fewer is "about to go out". */
export const BOT_DANGER_CARDS = 3;
/** Bombs are spent when the opponent who played has this many cards or fewer. */
export const BOT_BOMB_THRESHOLD = 6;

interface HandShape {
  bombRanks: Set<number>;
  jokerBomb: boolean;
}

function shapeOf(hand: readonly Card[], level: number): HandShape {
  const counts = new Map<number, number>();
  for (const c of hand) if (!isWild(c, level)) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  const bombRanks = new Set(NORMAL_RANKS.filter((r) => (counts.get(r) ?? 0) >= 4));
  const jokerBomb = counts.get(SMALL_JOKER) === 2 && counts.get(BIG_JOKER) === 2;
  return { bombRanks, jokerBomb };
}

/** A non-bomb play that spends a wild or breaks up a bomb. */
function isCostly(play: Combo, shape: HandShape, level: number): boolean {
  if (isBomb(play)) return false;
  if (play.cards.some((c) => isWild(c, level))) return true;
  if (play.cards.some((c) => shape.bombRanks.has(c.rank))) return true;
  if (shape.jokerBomb && play.cards.some((c) => isJoker(c))) return true;
  return false;
}

function toAction(play: Combo): Action {
  return {
    type: 'play',
    cardIds: play.cards.map((c) => c.id),
    choice: { type: play.type, rank: play.rank, size: play.size },
  };
}

function lowestReturn(hand: readonly Card[], level: number): Card {
  const options = returnCandidates(hand, level).filter((c) => !isWild(c, level));
  const pool = options.length ? options : returnCandidates(hand, level);
  const count = (r: number) => hand.filter((c) => c.rank === r && !isWild(c, level)).length;
  // Prefer giving away a lone low card rather than splitting a pair or a bomb.
  const singles = pool.filter((c) => count(c.rank) === 1);
  const pick = (singles.length ? singles : pool).sort((a, b) => cardPower(a, level) - cardPower(b, level))[0];
  return pick!;
}

/** What a bot needs to choose a play — available to clients too (GameView). */
export interface BotContext {
  seat: Seat;
  hand: readonly Card[];
  level: number;
  lastPlay: { seat: Seat; combo: Combo } | null;
  /** Cards left per seat (0 = finished). */
  cardCounts: readonly number[];
}

/**
 * Choose a play (or null = pass). Strategy:
 * - go out immediately if one play empties the hand;
 * - lead the lowest combo, shedding as many cards as possible at that rank, without
 *   breaking bombs or spending wilds (a bare bomb is led before a bomb gets split);
 * - follow an opponent with the lowest non-bomb that beats them; bomb only when that
 *   opponent is close to going out (or we can finish soon), otherwise pass;
 * - don't beat the partner unless an opponent is about to go out, and never bomb them.
 */
export function botChoosePlay(ctx: BotContext): Combo | null {
  const { seat, hand: own, level } = ctx;
  const current = ctx.lastPlay?.combo ?? null;
  const plays = generateLegalPlays(own, level, current).map((p) => strongestReading(p, level));
  if (plays.length === 0) return null;

  const finisher = plays.find((p) => p.size === own.length);
  if (finisher) return finisher;

  const shape = shapeOf(own, level);
  const normal = plays.filter((p) => !isBomb(p));
  const bombs = plays.filter((p) => isBomb(p)).sort((a, b) => bombStrength(a) - bombStrength(b));
  const cheap = normal.filter((p) => !isCostly(p, shape, level));
  const costly = normal.filter((p) => isCostly(p, shape, level));

  const opponents = ([0, 1, 2, 3] as Seat[]).filter((s) => teamOf(s) !== teamOf(seat) && ctx.cardCounts[s]! > 0);
  const minOpponentCards = Math.min(...opponents.map((s) => ctx.cardCounts[s]!), Infinity);
  const danger = minOpponentCards <= BOT_DANGER_CARDS;

  // ---- leading ----
  if (!current) {
    const byLead = (a: Combo, b: Combo) => comboFloor(a) - comboFloor(b) || b.size - a.size || a.rank - b.rank;
    if (cheap.length) {
      // When an opponent is nearly out, lead something long they are unlikely to match.
      if (danger) {
        const long = [...cheap].sort((a, b) => b.size - a.size || byLead(a, b));
        if (long[0]!.size > 1) return long[0]!;
      }
      return [...cheap].sort(byLead)[0]!;
    }
    // Only bombs and bomb-breaking plays left: lead the smallest bomb intact.
    if (bombs.length) return bombs[0]!;
    return [...costly].sort(byLead)[0]!;
  }

  // ---- following ----
  const lastSeat = ctx.lastPlay!.seat;
  const byRank = (a: Combo, b: Combo) => comboStrength(a) - comboStrength(b);

  if (lastSeat === partnerOf(seat)) {
    if (!danger || isBomb(current)) return null;
    return [...cheap].sort(byRank)[0] ?? null;
  }

  if (cheap.length) return [...cheap].sort(byRank)[0]!;

  const playerCards = ctx.cardCounts[lastSeat]!;
  const threatened = playerCards <= BOT_BOMB_THRESHOLD || danger;
  if (costly.length && (threatened || own.length <= 8)) return [...costly].sort(byRank)[0]!;
  if (bombs.length) {
    const bomb = bombs[0]!;
    if (threatened || own.length - bomb.size <= 4) return bomb;
  }
  return null;
}

/** Decide a move for a bot (or a human on autopilot) in any phase. */
export function botDecide(match: MatchState, seat: Seat): Action | null {
  const hand = match.hand;
  if (!pendingSeats(match).includes(seat)) return null;
  const own = hand.hands[seat]!;
  const level = hand.level;

  if (hand.phase === 'tribute') return timeoutAction(match, seat);
  if (hand.phase === 'return') return { type: 'return', cardId: lowestReturn(own, level).id };
  if (hand.phase !== 'play') return null;

  const play = botChoosePlay({
    seat,
    hand: own,
    level,
    lastPlay: hand.lastPlay,
    cardCounts: hand.hands.map((h) => h.length),
  });
  if (play) return toAction(play);
  return hand.lastPlay ? { type: 'pass' } : timeoutAction(match, seat);
}
