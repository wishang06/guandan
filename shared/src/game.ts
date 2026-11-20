import { ACE, BIG_JOKER, cardPower, createDeck, isWild, sortCards, type Card } from './cards';
import { getLegalInterpretations, sameKey, type Combo, type ComboKey } from './combos';
import { randomInt, randomSeed, shuffle } from './rng';

export type Seat = 0 | 1 | 2 | 3;
export type Team = 0 | 1;
export const SEATS: readonly Seat[] = [0, 1, 2, 3];
export const HAND_SIZE = 27;
export const MIN_LEVEL = 2;
export const MAX_LEVEL = ACE;

export const teamOf = (s: Seat): Team => (s % 2) as Team;
export const partnerOf = (s: Seat): Seat => ((s + 2) % 4) as Seat;
export const nextSeat = (s: Seat): Seat => ((s + 1) % 4) as Seat;
export const teamSeats = (t: Team): [Seat, Seat] => (t === 0 ? [0, 2] : [1, 3]);

export interface MatchConfig {
  /** Failed attempts at level A before the team is reset to 2. 0 = never reset. */
  aMaxFails: number;
}

export const DEFAULT_MATCH_CONFIG: MatchConfig = { aMaxFails: 3 };

export type HandPhase = 'tribute' | 'return' | 'play' | 'done';

export interface TributePayment {
  from: Seat;
  /** Receiver; assigned once every tribute card has been chosen. */
  to: Seat | null;
  card: Card | null;
  returnCard: Card | null;
}

export interface TributeState {
  kind: 'single' | 'double' | 'anti';
  /** Receivers in priority order (first place first). */
  receivers: Seat[];
  payments: TributePayment[];
}

export interface TrickEntry {
  seat: Seat;
  /** null = pass */
  combo: Combo | null;
}

export interface HandState {
  number: number;
  /** The level rank in force for this hand (级牌). */
  level: number;
  /** The team whose level is being played (null on the first hand). */
  declarer: Team | null;
  phase: HandPhase;
  hands: Card[][];
  tribute: TributeState | null;
  turn: Seat;
  leader: Seat;
  lastPlay: { seat: Seat; combo: Combo } | null;
  passCount: number;
  trick: TrickEntry[];
  finishOrder: Seat[];
}

export interface HandResult {
  handNumber: number;
  level: number;
  finishOrder: Seat[];
  winningTeam: Team;
  /** Where the winner's partner finished: 2, 3 or 4. */
  partnerPlace: 2 | 3 | 4;
  levelGain: number;
  levelsBefore: [number, number];
  levelsAfter: [number, number];
  /** Team that was playing its A level this hand, if any. */
  aAttempt: Team | null;
  aFailed: boolean;
  aReset: boolean;
  matchWinner: Team | null;
}

export type GameEventKind =
  | 'deal'
  | 'play'
  | 'pass'
  | 'finish'
  | 'trickWon'
  | 'jiefeng'
  | 'tribute'
  | 'return'
  | 'antiTribute'
  | 'handEnd'
  | 'matchEnd';

export interface GameEvent {
  seq: number;
  kind: GameEventKind;
  seat?: Seat;
  to?: Seat;
  combo?: Combo;
  card?: Card;
  place?: number;
}

export interface MatchState {
  config: MatchConfig;
  levels: [number, number];
  aFails: [number, number];
  /** Team whose level the current hand is played at. */
  declarer: Team | null;
  hand: HandState;
  results: HandResult[];
  winner: Team | null;
  rng: number;
  eventSeq: number;
  events: GameEvent[];
}

export type Action =
  | { type: 'play'; cardIds: number[]; choice?: ComboKey }
  | { type: 'pass' }
  | { type: 'tribute'; cardId: number }
  | { type: 'return'; cardId: number };

export type ActionError =
  | 'match_over'
  | 'wrong_phase'
  | 'not_your_turn'
  | 'invalid_cards'
  | 'invalid_combo'
  | 'does_not_beat'
  | 'ambiguous'
  | 'cannot_pass_when_leading'
  | 'invalid_tribute'
  | 'invalid_return';

export type ActionResult =
  | { ok: true; state: MatchState }
  | { ok: false; error: ActionError; options?: Combo[] };

const MAX_EVENTS = 60;

export interface CreateMatchOptions {
  seed?: number;
  config?: Partial<MatchConfig>;
  /** Fixed hands for tests (4 × 27 cards, or any sizes for unit tests). */
  hands?: Card[][];
  /** Who leads the first hand (random otherwise). */
  firstLeader?: Seat;
}

function pushEvent(m: MatchState, e: Omit<GameEvent, 'seq'>) {
  m.eventSeq += 1;
  m.events.push({ seq: m.eventSeq, ...e });
  if (m.events.length > MAX_EVENTS) m.events.splice(0, m.events.length - MAX_EVENTS);
}

function dealHands(m: MatchState, level: number, hands?: Card[][]): Card[][] {
  if (hands) return hands.map((h) => sortCards(h, level));
  const [deck, rng] = shuffle(createDeck(), m.rng);
  m.rng = rng;
  return SEATS.map((s) => sortCards(deck.slice(s * HAND_SIZE, (s + 1) * HAND_SIZE), level));
}

function emptyHand(number: number, level: number, declarer: Team | null): HandState {
  return {
    number,
    level,
    declarer,
    phase: 'play',
    hands: [[], [], [], []],
    tribute: null,
    turn: 0,
    leader: 0,
    lastPlay: null,
    passCount: 0,
    trick: [],
    finishOrder: [],
  };
}

export function createMatch(opts: CreateMatchOptions = {}): MatchState {
  const m: MatchState = {
    config: { ...DEFAULT_MATCH_CONFIG, ...opts.config },
    levels: [MIN_LEVEL, MIN_LEVEL],
    aFails: [0, 0],
    declarer: null,
    hand: emptyHand(1, MIN_LEVEL, null),
    results: [],
    winner: null,
    rng: (opts.seed ?? randomSeed()) >>> 0,
    eventSeq: 0,
    events: [],
  };
  m.hand.hands = dealHands(m, MIN_LEVEL, opts.hands);
  let leader: Seat;
  if (opts.firstLeader !== undefined) leader = opts.firstLeader;
  else {
    const [r, rng] = randomInt(4, m.rng);
    m.rng = rng;
    leader = r as Seat;
  }
  m.hand.turn = leader;
  m.hand.leader = leader;
  pushEvent(m, { kind: 'deal' });
  return m;
}

/** Start the next hand after one finished (deals, then sets up tribute or anti-tribute). */
export function startNextHand(match: MatchState, opts: { hands?: Card[][] } = {}): MatchState {
  const m = structuredClone(match);
  if (m.winner !== null) throw new Error('match is over');
  if (m.hand.phase !== 'done') throw new Error('current hand is not finished');
  const prev = m.results[m.results.length - 1];
  if (!prev) throw new Error('no previous result');

  const level = m.declarer === null ? MIN_LEVEL : m.levels[m.declarer];
  const hand = emptyHand(m.hand.number + 1, level, m.declarer);
  m.hand = hand;
  hand.hands = dealHands(m, level, opts.hands);
  pushEvent(m, { kind: 'deal' });

  const fo = prev.finishOrder;
  const double = teamOf(fo[0]!) === teamOf(fo[1]!);
  const givers: Seat[] = double ? [fo[2]!, fo[3]!] : [fo[3]!];
  const receivers: Seat[] = double ? [fo[0]!, fo[1]!] : [fo[0]!];
  const bigJokers = givers.reduce<number>((n, g) => n + hand.hands[g]!.filter((c) => c.rank === BIG_JOKER).length, 0);
  const payments = givers.map((from) => ({ from, to: null, card: null, returnCard: null }));

  if (bigJokers >= 2) {
    // 抗贡: the tributing side holds both big jokers — no tribute, first place leads.
    hand.tribute = { kind: 'anti', receivers, payments };
    hand.phase = 'play';
    hand.turn = fo[0]!;
    hand.leader = fo[0]!;
    pushEvent(m, { kind: 'antiTribute', seat: givers[0] });
  } else {
    hand.tribute = { kind: double ? 'double' : 'single', receivers, payments };
    hand.phase = 'tribute';
  }
  return m;
}

export function activeSeats(hand: HandState): Seat[] {
  return SEATS.filter((s) => hand.hands[s]!.length > 0 && !hand.finishOrder.includes(s));
}

function nextActive(hand: HandState, from: Seat): Seat {
  let s = nextSeat(from);
  for (let i = 0; i < 4; i++) {
    if (hand.hands[s]!.length > 0) return s;
    s = nextSeat(s);
  }
  return from;
}

/** Cards a tributer may give: their highest-power card, never the wild heart. */
export function tributeCandidates(hand: readonly Card[], level: number): Card[] {
  const pool = hand.filter((c) => !isWild(c, level));
  if (pool.length === 0) return [];
  const max = Math.max(...pool.map((c) => cardPower(c, level)));
  return sortCards(
    pool.filter((c) => cardPower(c, level) === max),
    level,
  );
}

/** Cards a receiver may return: natural rank 10 or lower (any card if they have none). */
export function returnCandidates(hand: readonly Card[], level: number): Card[] {
  const low = hand.filter((c) => c.rank <= 10);
  return sortCards(low.length ? low : hand, level);
}

function fail(error: ActionError, options?: Combo[]): ActionResult {
  return options ? { ok: false, error, options } : { ok: false, error };
}

export function applyAction(match: MatchState, seat: Seat, action: Action): ActionResult {
  if (match.winner !== null) return fail('match_over');
  const m = structuredClone(match);
  switch (action.type) {
    case 'play':
      return doPlay(m, seat, action.cardIds, action.choice);
    case 'pass':
      return doPass(m, seat);
    case 'tribute':
      return doTribute(m, seat, action.cardId);
    case 'return':
      return doReturn(m, seat, action.cardId);
    default:
      return fail('wrong_phase');
  }
}

function doPlay(m: MatchState, seat: Seat, cardIds: number[], choice?: ComboKey): ActionResult {
  const hand = m.hand;
  if (hand.phase !== 'play') return fail('wrong_phase');
  if (hand.turn !== seat) return fail('not_your_turn');
  const own = hand.hands[seat]!;
  if (cardIds.length === 0 || new Set(cardIds).size !== cardIds.length) return fail('invalid_cards');
  const cards: Card[] = [];
  for (const id of cardIds) {
    const c = own.find((x) => x.id === id);
    if (!c) return fail('invalid_cards');
    cards.push(c);
  }
  const current = hand.lastPlay?.combo ?? null;
  const legal = getLegalInterpretations(cards, hand.level, current);
  if (legal.length === 0) {
    const any = getLegalInterpretations(cards, hand.level, null);
    return fail(any.length ? 'does_not_beat' : 'invalid_combo');
  }
  let combo: Combo | undefined;
  if (choice) {
    // An explicit choice may be any valid reading, even one we would not have offered.
    combo =
      legal.find((c) => sameKey(c, choice)) ??
      getLegalInterpretations(cards, hand.level, current, { all: true }).find((c) => sameKey(c, choice));
    if (!combo) return fail('invalid_combo', legal);
  } else if (legal.length === 1) {
    combo = legal[0];
  } else {
    return fail('ambiguous', legal);
  }

  const ids = new Set(cardIds);
  hand.hands[seat] = own.filter((c) => !ids.has(c.id));
  hand.lastPlay = { seat, combo: combo! };
  hand.passCount = 0;
  hand.trick.push({ seat, combo: combo! });
  pushEvent(m, { kind: 'play', seat, combo: combo! });

  if (hand.hands[seat]!.length === 0) {
    hand.finishOrder.push(seat);
    pushEvent(m, { kind: 'finish', seat, place: hand.finishOrder.length });
    const fo = hand.finishOrder;
    const teamDone = ([0, 1] as Team[]).some((t) => teamSeats(t).every((s) => fo.includes(s)));
    if (teamDone) {
      endHand(m);
      return { ok: true, state: m };
    }
  }
  hand.turn = nextActive(hand, seat);
  return { ok: true, state: m };
}

function doPass(m: MatchState, seat: Seat): ActionResult {
  const hand = m.hand;
  if (hand.phase !== 'play') return fail('wrong_phase');
  if (hand.turn !== seat) return fail('not_your_turn');
  if (!hand.lastPlay) return fail('cannot_pass_when_leading');
  hand.passCount += 1;
  hand.trick.push({ seat, combo: null });
  pushEvent(m, { kind: 'pass', seat });

  const winner = hand.lastPlay.seat;
  const responders = activeSeats(hand).filter((s) => s !== winner).length;
  if (hand.passCount >= responders) {
    // Everyone passed. The last player leads; if they are out, their partner leads (接风).
    const winnerActive = hand.hands[winner]!.length > 0;
    const leader = winnerActive ? winner : partnerOf(winner);
    pushEvent(m, { kind: winnerActive ? 'trickWon' : 'jiefeng', seat: leader });
    hand.lastPlay = null;
    hand.passCount = 0;
    hand.trick = [];
    hand.turn = leader;
    hand.leader = leader;
  } else {
    hand.turn = nextActive(hand, seat);
  }
  return { ok: true, state: m };
}

function doTribute(m: MatchState, seat: Seat, cardId: number): ActionResult {
  const hand = m.hand;
  const t = hand.tribute;
  if (hand.phase !== 'tribute' || !t) return fail('wrong_phase');
  const pay = t.payments.find((p) => p.from === seat && p.card === null);
  if (!pay) return fail('invalid_tribute');
  const own = hand.hands[seat]!;
  const card = tributeCandidates(own, hand.level).find((c) => c.id === cardId);
  if (!card) return fail('invalid_tribute');
  hand.hands[seat] = own.filter((c) => c.id !== cardId);
  pay.card = card;

  if (t.payments.every((p) => p.card !== null)) {
    // Larger tribute goes to first place; ties go by turn order after first place.
    const first = t.receivers[0]!;
    const ordered = [...t.payments].sort(
      (a, b) =>
        cardPower(b.card!, hand.level) - cardPower(a.card!, hand.level) ||
        ((a.from - first + 4) % 4) - ((b.from - first + 4) % 4),
    );
    ordered.forEach((p, i) => {
      p.to = t.receivers[i]!;
      hand.hands[p.to] = sortCards([...hand.hands[p.to]!, p.card!], hand.level);
      pushEvent(m, { kind: 'tribute', seat: p.from, to: p.to, card: p.card! });
    });
    hand.phase = 'return';
  }
  return { ok: true, state: m };
}

function doReturn(m: MatchState, seat: Seat, cardId: number): ActionResult {
  const hand = m.hand;
  const t = hand.tribute;
  if (hand.phase !== 'return' || !t) return fail('wrong_phase');
  const pay = t.payments.find((p) => p.to === seat && p.returnCard === null);
  if (!pay) return fail('invalid_return');
  const own = hand.hands[seat]!;
  const card = returnCandidates(own, hand.level).find((c) => c.id === cardId);
  if (!card) return fail('invalid_return');
  hand.hands[seat] = own.filter((c) => c.id !== cardId);
  pay.returnCard = card;

  if (t.payments.every((p) => p.returnCard !== null)) {
    for (const p of t.payments) {
      hand.hands[p.from] = sortCards([...hand.hands[p.from]!, p.returnCard!], hand.level);
      pushEvent(m, { kind: 'return', seat: p.to!, to: p.from });
    }
    // The player who paid first place leads.
    const lead = t.payments.find((p) => p.to === t.receivers[0])!.from;
    hand.phase = 'play';
    hand.turn = lead;
    hand.leader = lead;
  }
  return { ok: true, state: m };
}

/** Levels gained by the winning team given where the partner finished. */
export function levelGainFor(partnerPlace: 2 | 3 | 4): number {
  return partnerPlace === 2 ? 3 : partnerPlace === 3 ? 2 : 1;
}

function endHand(m: MatchState) {
  const hand = m.hand;
  const fo = [...hand.finishOrder];
  // Remaining players fill the last places in turn order after the last finisher.
  let s = fo[fo.length - 1]!;
  for (let i = 0; i < 4 && fo.length < 4; i++) {
    s = nextSeat(s);
    if (!fo.includes(s)) fo.push(s);
  }
  const winningTeam = teamOf(fo[0]!);
  const partnerPlace = (fo.indexOf(partnerOf(fo[0]!)) + 1) as 2 | 3 | 4;
  const gain = levelGainFor(partnerPlace);
  const levelsBefore: [number, number] = [...m.levels];

  let aAttempt: Team | null = null;
  let aFailed = false;
  let aReset = false;
  let matchWinner: Team | null = null;
  const d = hand.declarer;
  if (d !== null && hand.level === MAX_LEVEL && m.levels[d] === MAX_LEVEL) {
    aAttempt = d;
    if (winningTeam === d && partnerPlace <= 3) {
      matchWinner = d;
    } else {
      aFailed = true;
      m.aFails[d] += 1;
      if (m.config.aMaxFails > 0 && m.aFails[d] >= m.config.aMaxFails) {
        m.levels[d] = MIN_LEVEL;
        m.aFails[d] = 0;
        aReset = true;
      }
    }
  }
  let levelGain = 0;
  if (matchWinner === null && winningTeam !== aAttempt) {
    const before = m.levels[winningTeam];
    m.levels[winningTeam] = Math.min(MAX_LEVEL, before + gain);
    levelGain = m.levels[winningTeam] - before;
  }

  const result: HandResult = {
    handNumber: hand.number,
    level: hand.level,
    finishOrder: fo,
    winningTeam,
    partnerPlace,
    levelGain,
    levelsBefore,
    levelsAfter: [...m.levels],
    aAttempt,
    aFailed,
    aReset,
    matchWinner,
  };
  m.results.push(result);
  hand.finishOrder = fo;
  hand.phase = 'done';
  hand.lastPlay = null;
  hand.trick = [];
  m.declarer = winningTeam;
  pushEvent(m, { kind: 'handEnd', seat: fo[0] });
  if (matchWinner !== null) {
    m.winner = matchWinner;
    pushEvent(m, { kind: 'matchEnd', seat: fo[0] });
  }
}

/** Who still owes an action in the current phase (for timers / bots). */
export function pendingSeats(match: MatchState): Seat[] {
  const hand = match.hand;
  if (match.winner !== null) return [];
  switch (hand.phase) {
    case 'play':
      return [hand.turn];
    case 'tribute':
      return hand.tribute!.payments.filter((p) => p.card === null).map((p) => p.from);
    case 'return':
      return hand.tribute!.payments.filter((p) => p.returnCard === null).map((p) => p.to!);
    default:
      return [];
  }
}

/**
 * The default action when a player's timer runs out: pass when following, play the
 * lowest single when leading, give the required tribute, return the lowest small card.
 */
export function timeoutAction(match: MatchState, seat: Seat): Action | null {
  const hand = match.hand;
  const own = hand.hands[seat]!;
  if (!pendingSeats(match).includes(seat)) return null;
  if (hand.phase === 'tribute') return { type: 'tribute', cardId: tributeCandidates(own, hand.level)[0]!.id };
  if (hand.phase === 'return') return { type: 'return', cardId: returnCandidates(own, hand.level)[0]!.id };
  if (hand.phase === 'play') {
    if (hand.lastPlay) return { type: 'pass' };
    const sorted = sortCards(own, hand.level);
    const lowest = sorted.find((c) => !isWild(c, hand.level)) ?? sorted[0]!;
    return { type: 'play', cardIds: [lowest.id] };
  }
  return null;
}
