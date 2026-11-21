import { describe, expect, it } from 'vitest';
import { BIG_JOKER, makeCardFactory, makeCards, type Card } from './cards';
import {
  applyAction,
  createMatch,
  pendingSeats,
  startNextHand,
  timeoutAction,
  type Action,
  type MatchState,
  type Seat,
  type Team,
} from './game';
import { generateLegalPlays } from './generate';
import { isBomb, type ComboKey } from './combos';

// ---------- helpers ----------

function hands(specs: string[]): Card[][] {
  const f = makeCardFactory();
  return specs.map((s) => makeCards(s, f));
}

function setup(specs: string[], leader: Seat = 0): MatchState {
  return createMatch({ hands: hands(specs), firstLeader: leader, seed: 1 });
}

/** Put the match at given team levels with `declarer` playing its level this hand. */
function atLevels(m: MatchState, levels: [number, number], declarer: Team): MatchState {
  m.levels = levels;
  m.declarer = declarer;
  m.hand.declarer = declarer;
  m.hand.level = levels[declarer];
  return m;
}

function idsFor(m: MatchState, seat: Seat, specs: string): number[] {
  const want = makeCards(specs, makeCardFactory());
  const pool = [...m.hand.hands[seat]!];
  return want.map((w) => {
    const i = pool.findIndex((c) => c.suit === w.suit && c.rank === w.rank);
    if (i < 0) throw new Error(`seat ${seat} has no ${specs}`);
    return pool.splice(i, 1)[0]!.id;
  });
}

function act(m: MatchState, seat: Seat, action: Action): MatchState {
  const r = applyAction(m, seat, action);
  if (!r.ok) throw new Error(`seat ${seat} ${action.type}: ${r.error}`);
  return r.state;
}

const play = (m: MatchState, seat: Seat, specs: string, choice?: ComboKey) =>
  act(m, seat, { type: 'play', cardIds: idsFor(m, seat, specs), choice });
const pass = (m: MatchState, seat: Seat) => act(m, seat, { type: 'pass' });

function err(m: MatchState, seat: Seat, action: Action) {
  const r = applyAction(m, seat, action);
  return r.ok ? 'ok' : r.error;
}

/** Hand where team 0 finishes 1st and 2nd: [0, 2, 3, 1]. */
function finish12(m: MatchState): MatchState {
  m = play(m, 0, 'S3');
  m = pass(pass(pass(m, 1), 2), 3);
  return play(m, 2, 'S5');
}
const HANDS_12 = ['S3', 'S7 S8', 'S5', 'S9 S10'];

/** Team 0 finishes 1st and 3rd: [0, 1, 2, 3]. */
function finish13(m: MatchState): MatchState {
  return play(play(play(m, 0, 'S3'), 1, 'S4'), 2, 'S5');
}
const HANDS_13 = ['S3', 'S4', 'S5', 'S9 S10'];

/** Team 0 finishes 1st and 4th: [0, 1, 3, 2]. */
function finish14(m: MatchState): MatchState {
  m = play(play(m, 0, 'S3'), 1, 'S4');
  m = pass(m, 2);
  return play(m, 3, 'S5');
}
const HANDS_14 = ['S3', 'S4', 'D6 D7', 'S5'];

/** Team 1 finishes 1st and 2nd (seat 1 leads): [1, 3, 0, 2]. */
function team1Wins12(m: MatchState): MatchState {
  m = play(m, 1, 'S3');
  m = pass(pass(pass(m, 2), 3), 0);
  return play(m, 3, 'S4');
}
const HANDS_T1 = ['S9 S10', 'S3', 'S7 S8', 'S4'];

// ---------- turn flow ----------

describe('turn flow', () => {
  it('goes round the table and the last player to play leads again', () => {
    let m = setup(['S3 S9', 'S4 S10', 'S5 SJ', 'S6 SQ']);
    expect(m.hand.turn).toBe(0);
    m = play(m, 0, 'S3');
    expect(m.hand.turn).toBe(1);
    m = play(m, 1, 'S4');
    m = pass(m, 2);
    m = pass(m, 3);
    expect(m.hand.turn).toBe(0);
    m = pass(m, 0);
    // Everyone else passed: seat 1 wins the trick and leads.
    expect(m.hand.turn).toBe(1);
    expect(m.hand.leader).toBe(1);
    expect(m.hand.lastPlay).toBeNull();
    expect(m.hand.trick).toEqual([]);
  });

  it('rejects out-of-turn, illegal and non-beating plays', () => {
    const m = setup(['S3 S9 D9', 'S4 S10', 'S5 SJ', 'S6 SQ']);
    expect(err(m, 1, { type: 'pass' })).toBe('not_your_turn');
    expect(err(m, 0, { type: 'pass' })).toBe('cannot_pass_when_leading');
    expect(err(m, 0, { type: 'play', cardIds: idsFor(m, 0, 'S3 S9') })).toBe('invalid_combo');
    expect(err(m, 0, { type: 'play', cardIds: [999] })).toBe('invalid_cards');
    expect(err(m, 0, { type: 'play', cardIds: [] })).toBe('invalid_cards');
    const m2 = play(m, 0, 'S9 D9');
    expect(err(m2, 1, { type: 'play', cardIds: idsFor(m2, 1, 'S10') })).toBe('does_not_beat');
  });

  it('must follow with the same shape unless bombing', () => {
    let m = setup(['S3 S9', 'S4 D4 C4 H4 S10', 'S5 SJ', 'S6 SQ']);
    m = play(m, 0, 'S9');
    expect(err(m, 1, { type: 'play', cardIds: idsFor(m, 1, 'S4 D4') })).toBe('does_not_beat');
    m = play(m, 1, 'S4 D4 C4 H4');
    expect(m.hand.lastPlay?.combo.type).toBe('bomb');
  });

  it('skips players who have finished', () => {
    let m = setup(['S3', 'S4 S9', 'S5 SJ', 'S6 SQ']);
    m = play(m, 0, 'S3'); // seat 0 out
    m = play(m, 1, 'S4');
    m = play(m, 2, 'S5');
    m = play(m, 3, 'S6');
    expect(m.hand.turn).toBe(1); // seat 0 skipped
  });

  it('asks for a choice when wild cards are ambiguous, and accepts one', () => {
    // Level 2: H2 is wild. Two wilds + 33 44 = tube 334455 or plate 333444.
    const m = setup(['H2 H2 S3 D3 S4 D4 S9', 'S5', 'S6', 'S7']);
    const cardIds = idsFor(m, 0, 'H2 H2 S3 D3 S4 D4');
    const r = applyAction(m, 0, { type: 'play', cardIds });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('ambiguous');
    expect(r.options!.map((o) => o.type).sort()).toEqual(['plate', 'tube']);
    const m2 = act(m, 0, { type: 'play', cardIds, choice: { type: 'plate', rank: 4, size: 6 } });
    expect(m2.hand.lastPlay?.combo).toMatchObject({ type: 'plate', rank: 4 });
    expect(err(m, 0, { type: 'play', cardIds, choice: { type: 'straight', rank: 5, size: 6 } })).toBe('invalid_combo');
  });
});

describe('接风 (partner takes the lead)', () => {
  it('passes the lead to the partner when a player goes out and everyone passes', () => {
    let m = setup(['S3', 'S7 S8', 'S5 S6', 'S9 S10']);
    m = play(m, 0, 'S3');
    expect(m.hand.finishOrder).toEqual([0]);
    m = pass(m, 1);
    m = pass(m, 2);
    m = pass(m, 3);
    expect(m.hand.turn).toBe(2);
    expect(m.hand.leader).toBe(2);
    expect(m.events.some((e) => e.kind === 'jiefeng' && e.seat === 2)).toBe(true);
  });

  it('does not apply when someone beats the final play', () => {
    let m = setup(['S3', 'S7 S8', 'S5 S6', 'S9 S10']);
    m = play(m, 0, 'S3');
    m = play(m, 1, 'S7');
    m = pass(m, 2);
    m = pass(m, 3);
    expect(m.hand.turn).toBe(1);
  });

  it('applies when the trick winner went out later in the trick', () => {
    let m = setup(['S3 S4', 'S7', 'S5 S6', 'S9 S10']);
    m = play(m, 0, 'S3');
    m = play(m, 1, 'S7'); // seat 1 out
    m = pass(m, 2);
    m = pass(m, 3);
    m = pass(m, 0);
    expect(m.hand.turn).toBe(3); // seat 1's partner
  });
});

// ---------- finishing & promotion ----------

describe('promotion', () => {
  it('1st & 2nd: +3 levels', () => {
    const m = finish12(setup(HANDS_12));
    expect(m.hand.phase).toBe('done');
    const r = m.results[0]!;
    expect(r.finishOrder).toEqual([0, 2, 3, 1]);
    expect(r).toMatchObject({ winningTeam: 0, partnerPlace: 2, levelGain: 3 });
    expect(m.levels).toEqual([5, 2]);
    expect(m.declarer).toBe(0);
  });

  it('1st & 3rd: +2 levels', () => {
    const m = finish13(setup(HANDS_13));
    expect(m.results[0]).toMatchObject({ finishOrder: [0, 1, 2, 3], partnerPlace: 3, levelGain: 2 });
    expect(m.levels).toEqual([4, 2]);
  });

  it('1st & 4th: +1 level', () => {
    const m = finish14(setup(HANDS_14));
    expect(m.results[0]).toMatchObject({ finishOrder: [0, 1, 3, 2], partnerPlace: 4, levelGain: 1 });
    expect(m.levels).toEqual([3, 2]);
  });

  it('the next hand is played at the winning team’s level', () => {
    const m = startNextHand(finish12(setup(HANDS_12)));
    expect(m.hand.number).toBe(2);
    expect(m.hand.level).toBe(5);
    expect(m.hand.declarer).toBe(0);
  });

  it('caps the level at A', () => {
    const m = finish12(atLevels(setup(HANDS_12), [13, 2], 0));
    expect(m.levels).toEqual([14, 2]);
    expect(m.winner).toBeNull();
  });

  it('cannot start the next hand before this one ends', () => {
    expect(() => startNextHand(setup(HANDS_12))).toThrow();
  });
});

describe('winning at level A', () => {
  it('wins the match at A with 1st & 2nd', () => {
    const m = finish12(atLevels(setup(HANDS_12), [14, 9], 0));
    expect(m.winner).toBe(0);
    expect(m.results[0]!.matchWinner).toBe(0);
    expect(applyAction(m, 0, { type: 'pass' })).toMatchObject({ ok: false, error: 'match_over' });
  });

  it('wins the match at A with 1st & 3rd', () => {
    const m = finish13(atLevels(setup(HANDS_13), [14, 9], 0));
    expect(m.winner).toBe(0);
  });

  it('1st & 4th at A is a failed attempt', () => {
    const m = finish14(atLevels(setup(HANDS_14), [14, 9], 0));
    expect(m.winner).toBeNull();
    expect(m.aFails).toEqual([1, 0]);
    expect(m.levels).toEqual([14, 9]);
    expect(m.results[0]).toMatchObject({ aAttempt: 0, aFailed: true, aReset: false });
  });

  it('losing at A is a failed attempt and the opponents promote', () => {
    const m = team1Wins12(atLevels(setup(HANDS_T1, 1), [14, 9], 0));
    expect(m.aFails).toEqual([1, 0]);
    expect(m.levels).toEqual([14, 12]);
    expect(m.declarer).toBe(1);
  });

  it('resets to 2 after 3 failed A attempts', () => {
    const m0 = atLevels(setup(HANDS_14), [14, 9], 0);
    m0.aFails = [2, 0];
    const m = finish14(m0);
    expect(m.levels).toEqual([2, 9]);
    expect(m.aFails).toEqual([0, 0]);
    expect(m.results[0]!.aReset).toBe(true);
  });

  it('the reset threshold is configurable (0 = never reset)', () => {
    const m0 = createMatch({ hands: hands(HANDS_14), firstLeader: 0, config: { aMaxFails: 0 } });
    atLevels(m0, [14, 9], 0);
    m0.aFails = [10, 0];
    const m = finish14(m0);
    expect(m.levels).toEqual([14, 9]);
    expect(m.aFails[0]).toBe(11);
  });

  it('winning at A while the opponents declare does not end the match', () => {
    const m = finish12(atLevels(setup(HANDS_12), [14, 9], 1));
    expect(m.winner).toBeNull();
    expect(m.declarer).toBe(0);
    expect(m.levels).toEqual([14, 9]);
    expect(startNextHand(m).hand.level).toBe(14);
  });
});

// ---------- tribute ----------

describe('tribute (进贡 / 还贡)', () => {
  // After finish13 → order [0,1,2,3], team 0 at level 4: seat 3 pays seat 0.
  const afterSingle = () => finish13(setup(HANDS_13));

  it('the last finisher gives their highest card to the first; first returns ≤10', () => {
    const next = hands([
      'S5 S6 DJ DQ', // seat 0 receives
      'D3 D5',
      'C3 C5',
      'H4 SK DK S3', // seat 3 pays: H4 is wild (level 4) so the highest is a K
    ]);
    let m = startNextHand(afterSingle(), { hands: next });
    expect(m.hand.level).toBe(4);
    expect(m.hand.phase).toBe('tribute');
    expect(m.hand.tribute?.kind).toBe('single');
    expect(pendingSeats(m)).toEqual([3]);

    expect(err(m, 3, { type: 'tribute', cardId: idsFor(m, 3, 'H4')[0]! })).toBe('invalid_tribute');
    expect(err(m, 3, { type: 'tribute', cardId: idsFor(m, 3, 'S3')[0]! })).toBe('invalid_tribute');
    expect(err(m, 0, { type: 'tribute', cardId: idsFor(m, 0, 'DQ')[0]! })).toBe('invalid_tribute');
    // Either K is acceptable.
    m = act(m, 3, { type: 'tribute', cardId: idsFor(m, 3, 'DK')[0]! });
    expect(m.hand.phase).toBe('return');
    expect(m.hand.hands[0]!.some((c) => c.rank === 13)).toBe(true);
    expect(m.hand.hands[3]).toHaveLength(3);
    expect(pendingSeats(m)).toEqual([0]);

    expect(err(m, 0, { type: 'return', cardId: idsFor(m, 0, 'DJ')[0]! })).toBe('invalid_return');
    m = act(m, 0, { type: 'return', cardId: idsFor(m, 0, 'S6')[0]! });
    expect(m.hand.phase).toBe('play');
    expect(m.hand.hands[0]).toHaveLength(4);
    expect(m.hand.hands[3]!.map((c) => c.rank)).toContain(6);
    // The tributer leads the first trick.
    expect(m.hand.turn).toBe(3);
  });

  it('a non-heart level card outranks an A and must be given', () => {
    const next = hands(['S5 S6', 'D3', 'C3', 'H4 S4 SA']);
    const m = startNextHand(afterSingle(), { hands: next });
    expect(err(m, 3, { type: 'tribute', cardId: idsFor(m, 3, 'SA')[0]! })).toBe('invalid_tribute');
    expect(err(m, 3, { type: 'tribute', cardId: idsFor(m, 3, 'S4')[0]! })).toBe('ok');
  });

  it('a big joker is given when it is the highest card', () => {
    const next = hands(['S5 S6', 'D3', 'C3', 'JB SA']);
    let m = startNextHand(afterSingle(), { hands: next });
    m = act(m, 3, { type: 'tribute', cardId: idsFor(m, 3, 'JB')[0]! });
    expect(m.hand.hands[0]!.some((c) => c.rank === BIG_JOKER)).toBe(true);
  });

  it('may return any card when holding nothing ≤10', () => {
    const next = hands(['SJ SQ', 'D3', 'C3', 'SA S3']);
    let m = startNextHand(afterSingle(), { hands: next });
    m = act(m, 3, { type: 'tribute', cardId: idsFor(m, 3, 'SA')[0]! });
    m = act(m, 0, { type: 'return', cardId: idsFor(m, 0, 'SQ')[0]! });
    expect(m.hand.phase).toBe('play');
  });

  it('double-down (双下): both losers pay; the larger card goes to first place', () => {
    // finish12 → [0, 2, 3, 1]: seats 3 and 1 pay seats 0 and 2. Level 5.
    const next = hands(['S6 S7', 'SK S3', 'S8 S9', 'SA S2']);
    let m = startNextHand(finish12(setup(HANDS_12)), { hands: next });
    expect(m.hand.tribute?.kind).toBe('double');
    expect(pendingSeats(m).sort()).toEqual([1, 3]);
    m = act(m, 1, { type: 'tribute', cardId: idsFor(m, 1, 'SK')[0]! });
    expect(m.hand.phase).toBe('tribute');
    m = act(m, 3, { type: 'tribute', cardId: idsFor(m, 3, 'SA')[0]! });
    expect(m.hand.phase).toBe('return');
    const pays = m.hand.tribute!.payments;
    expect(pays.find((p) => p.from === 3)!.to).toBe(0);
    expect(pays.find((p) => p.from === 1)!.to).toBe(2);
    expect(m.hand.hands[0]!.some((c) => c.rank === 14)).toBe(true);
    expect(m.hand.hands[2]!.some((c) => c.rank === 13)).toBe(true);

    m = act(m, 2, { type: 'return', cardId: idsFor(m, 2, 'S8')[0]! });
    m = act(m, 0, { type: 'return', cardId: idsFor(m, 0, 'S6')[0]! });
    expect(m.hand.hands[3]!.some((c) => c.rank === 6)).toBe(true);
    expect(m.hand.hands[1]!.some((c) => c.rank === 8)).toBe(true);
    // Whoever paid first place leads.
    expect(m.hand.turn).toBe(3);
  });

  it('double-down tie: the payer next in turn after first place pays first place', () => {
    const next = hands(['S6 S7', 'SA S3', 'S8 S9', 'DA S2']);
    let m = startNextHand(finish12(setup(HANDS_12)), { hands: next });
    m = act(m, 3, { type: 'tribute', cardId: idsFor(m, 3, 'DA')[0]! });
    m = act(m, 1, { type: 'tribute', cardId: idsFor(m, 1, 'SA')[0]! });
    const pays = m.hand.tribute!.payments;
    expect(pays.find((p) => p.from === 1)!.to).toBe(0);
    expect(pays.find((p) => p.from === 3)!.to).toBe(2);
    m = act(m, 0, { type: 'return', cardId: idsFor(m, 0, 'S6')[0]! });
    m = act(m, 2, { type: 'return', cardId: idsFor(m, 2, 'S8')[0]! });
    expect(m.hand.turn).toBe(1);
  });

  it('anti-tribute (抗贡): the lone payer holds both big jokers', () => {
    const next = hands(['S6 S7', 'D3', 'C3', 'JB JB S3']);
    const m = startNextHand(afterSingle(), { hands: next });
    expect(m.hand.tribute?.kind).toBe('anti');
    expect(m.hand.phase).toBe('play');
    expect(m.hand.turn).toBe(0); // first place leads
    expect(m.hand.hands[3]).toHaveLength(3);
    expect(m.events.some((e) => e.kind === 'antiTribute')).toBe(true);
  });

  it('anti-tribute on a double-down when the two payers hold one big joker each', () => {
    const next = hands(['S6 S7', 'JB S3', 'S8 S9', 'JB S2']);
    const m = startNextHand(finish12(setup(HANDS_12)), { hands: next });
    expect(m.hand.tribute?.kind).toBe('anti');
    expect(m.hand.turn).toBe(0);
  });

  it('one big joker is not enough to refuse tribute', () => {
    const next = hands(['S6 S7', 'D3', 'C3', 'JB S3']);
    const m = startNextHand(afterSingle(), { hands: next });
    expect(m.hand.tribute?.kind).toBe('single');
    expect(m.hand.phase).toBe('tribute');
  });

  it('play is not allowed during tribute', () => {
    const next = hands(['S6 S7', 'D3', 'C3', 'SK S3']);
    const m = startNextHand(afterSingle(), { hands: next });
    expect(err(m, 3, { type: 'play', cardIds: idsFor(m, 3, 'S3') })).toBe('wrong_phase');
  });
});

// ---------- timeouts ----------

describe('timeoutAction', () => {
  it('leads the lowest single (not a wild) and passes when following', () => {
    let m = setup(['H2 S9 S3', 'S4', 'S5', 'S6']);
    const lead = timeoutAction(m, 0)!;
    expect(lead.type).toBe('play');
    m = act(m, 0, lead);
    expect(m.hand.lastPlay?.combo.rank).toBe(3);
    expect(timeoutAction(m, 1)).toEqual({ type: 'pass' });
    expect(timeoutAction(m, 2)).toBeNull(); // not their turn
  });

  it('gives the required tribute and returns the lowest card', () => {
    const next = hands(['S5 S6 DJ', 'D3', 'C3', 'SK S3']);
    let m = startNextHand(finish13(setup(HANDS_13)), { hands: next });
    m = act(m, 3, timeoutAction(m, 3)!);
    expect(m.hand.hands[0]!.some((c) => c.rank === 13)).toBe(true);
    m = act(m, 0, timeoutAction(m, 0)!);
    expect(m.hand.hands[3]!.some((c) => c.rank === 5)).toBe(true);
  });
});

// ---------- full simulation ----------

function simplePolicy(m: MatchState, seat: Seat): Action {
  const hand = m.hand;
  if (hand.phase !== 'play') return timeoutAction(m, seat)!;
  const own = hand.hands[seat]!;
  const legal = generateLegalPlays(own, hand.level, hand.lastPlay?.combo ?? null);
  const pick = hand.lastPlay ? legal.find((c) => !isBomb(c)) : legal[legal.length > 3 ? 1 : 0];
  if (!pick) return hand.lastPlay ? { type: 'pass' } : timeoutAction(m, seat)!;
  return { type: 'play', cardIds: pick.cards.map((c) => c.id), choice: pick };
}

describe('simulated matches', () => {
  it('plays many full hands without breaking invariants', () => {
    for (let seed = 1; seed <= 4; seed++) {
      let m = createMatch({ seed });
      let hands = 0;
      for (let steps = 0; steps < 20_000 && hands < 12 && m.winner === null; steps++) {
        if (m.hand.phase === 'done') {
          m = startNextHand(m);
          hands++;
          continue;
        }
        const ids = m.hand.hands.flat().map((c) => c.id);
        expect(new Set(ids).size).toBe(ids.length);
        const seat = pendingSeats(m)[0]!;
        const r = applyAction(m, seat, simplePolicy(m, seat));
        if (!r.ok) throw new Error(`seed ${seed}: ${r.error}`);
        m = r.state;
      }
      expect(m.winner !== null || m.results.length >= 10).toBe(true);
      for (const r of m.results) {
        expect(new Set(r.finishOrder).size).toBe(4);
        expect(r.levelsAfter.every((l) => l >= 2 && l <= 14)).toBe(true);
      }
    }
  });
});
