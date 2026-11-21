import { describe, expect, it } from 'vitest';
import { makeCardFactory, makeCards, type Card } from './cards';
import { applyAction, createMatch, pendingSeats, startNextHand, type Action, type MatchState, type Seat } from './game';
import { botDecide } from './bot';

function hands(specs: string[]): Card[][] {
  const f = makeCardFactory();
  return specs.map((s) => makeCards(s, f));
}

function setup(specs: string[], leader: Seat = 0): MatchState {
  return createMatch({ hands: hands(specs), firstLeader: leader, seed: 5 });
}

function act(m: MatchState, seat: Seat, action: Action): MatchState {
  const r = applyAction(m, seat, action);
  if (!r.ok) throw new Error(`${action.type}: ${r.error}`);
  return r.state;
}

const playIds = (m: MatchState, seat: Seat, specs: string): Action => {
  const want = makeCards(specs, makeCardFactory());
  const pool = [...m.hand.hands[seat]!];
  return {
    type: 'play',
    cardIds: want.map((w) => pool.splice(pool.findIndex((c) => c.suit === w.suit && c.rank === w.rank), 1)[0]!.id),
  };
};

/** Ranks of the cards the bot decided to play (sorted), or 'pass'. */
function decision(m: MatchState, seat: Seat): string {
  const a = botDecide(m, seat);
  if (!a) return 'none';
  if (a.type === 'pass') return 'pass';
  if (a.type !== 'play') return a.type;
  const own = m.hand.hands[seat]!;
  return a.cardIds
    .map((id) => own.find((c) => c.id === id)!.rank)
    .sort((x, y) => x - y)
    .join(' ');
}

const MANY = 'S9 D9 SK DK SQ DQ S8 D8 C8 SJ DJ';

describe('botDecide: leading', () => {
  it('goes out when one play empties the hand', () => {
    const m = setup(['S9 D9 C9 S4 D4', 'S3', 'S5', 'S6']);
    expect(decision(m, 0)).toBe('4 4 9 9 9');
  });

  it('leads the lowest cards, shedding the biggest combo at that rank', () => {
    const m = setup(['S3 D3 C3 S6 D6 SK SA', MANY, MANY.replace(/S/g, 'H'), 'S4']);
    expect(decision(m, 0)).toBe('3 3 3 6 6');
  });

  it('does not break a bomb or spend a wild to lead', () => {
    // Level 2: H2 is wild. 7777 is a bomb.
    const m = setup(['S7 D7 C7 H7 H2 S9 SQ', MANY, MANY.replace(/S/g, 'H'), 'S4 S5']);
    expect(decision(m, 0)).toBe('9');
  });

  it('leads a bomb only when nothing else is left', () => {
    const m = setup(['S7 D7 C7 H7 S8 D8 C8 H8', 'S3 S4 S5 S6 S10 SJ SQ SK SA', 'D3 D4 D5 D6 D10 DJ DQ DK DA', 'C4 C5']);
    expect(decision(m, 0)).toBe('7 7 7 7');
  });
});

describe('botDecide: following', () => {
  it('beats an opponent with the lowest non-bomb', () => {
    let m = setup(['S5 SK', 'S9 SJ SA S3 S4', 'S6 S7', 'S8 S10 SQ JB S3 S4 S5']);
    m = act(m, 0, playIds(m, 0, 'S5'));
    expect(decision(m, 1)).toBe('9');
  });

  it('passes on its partner’s play', () => {
    let m = setup(['S5 SK', 'S9 SJ SA S3 S4 S6 S7', 'S6 S7 SQ S8 S9 S10', 'S8 S10 SQ JB S3 S4 S5']);
    m = act(m, 0, playIds(m, 0, 'S5'));
    m = act(m, 1, { type: 'pass' });
    expect(decision(m, 2)).toBe('pass');
  });

  it('takes over from its partner when an opponent is about to go out', () => {
    let m = setup(['S5 SK S3 D3 C3 S4 D4', 'S9 SJ', 'S6 S7 SQ S8 S9 S10', 'S8 S10 SQ JB S3 S4 S5']);
    m = act(m, 0, playIds(m, 0, 'S5'));
    m = act(m, 1, { type: 'pass' }); // seat 1, an opponent of seat 2, has only 2 cards
    expect(decision(m, 2)).toBe('6');
  });

  it('never bombs its partner', () => {
    let m = setup(['S5 SK S3 D3', 'S9', 'S7 D7 C7 H7 S9', 'S8 S10 SQ JB S3 S4 S5']);
    m = act(m, 0, playIds(m, 0, 'SK'));
    m = act(m, 1, { type: 'pass' });
    expect(decision(m, 2)).toBe('pass');
  });

  it('saves bombs against an opponent with many cards', () => {
    let m = setup(['SA S3 S4 S5 S6 S8 S9 S10 SJ SQ', 'S7 D7 C7 H7 D3 D4 D5 D6 D8 D9', 'C3 C4 C5 C6 C8 C9 C10', 'H8']);
    m = act(m, 0, playIds(m, 0, 'SA'));
    expect(decision(m, 1)).toBe('pass');
  });

  it('bombs an opponent who is close to going out', () => {
    let m = setup(['SA S3 S4', 'S7 D7 C7 H7 S3 S4 S5 S6 S8 S9', 'S6', 'S8']);
    m = act(m, 0, playIds(m, 0, 'SA'));
    expect(decision(m, 1)).toBe('7 7 7 7');
  });
});

describe('botDecide: tribute', () => {
  it('pays the highest card and returns a lone low card', () => {
    let m = createMatch({ hands: hands(['S3', 'S4', 'S5', 'S9 S10']), firstLeader: 0 });
    m = act(act(act(m, 0, playIds(m, 0, 'S3')), 1, playIds(m, 1, 'S4')), 2, playIds(m, 2, 'S5'));
    // Hand 2 at level 4: seat 3 pays seat 0.
    m = startNextHand(m, { hands: hands(['S6 D6 S8 SQ', 'D3', 'C3', 'SK S3 D5']) });
    const t = botDecide(m, 3)!;
    m = act(m, 3, t);
    expect(m.hand.hands[0]!.some((c) => c.rank === 13)).toBe(true);
    const r = botDecide(m, 0)!;
    expect(r.type).toBe('return');
    m = act(m, 0, r);
    // Returned the lone 8, keeping the pair of 6s.
    expect(m.hand.hands[3]!.some((c) => c.rank === 8)).toBe(true);
  });
});

describe('bot-only matches', () => {
  it('four bots play whole matches to a winner without illegal moves', () => {
    for (const seed of [11, 12, 13]) {
      let m = createMatch({ seed });
      let steps = 0;
      while (m.winner === null && m.results.length < 150) {
        if (m.hand.phase === 'done') {
          m = startNextHand(m);
          continue;
        }
        for (const seat of pendingSeats(m)) {
          const action = botDecide(m, seat);
          expect(action, `seed ${seed} step ${steps}`).not.toBeNull();
          const r = applyAction(m, seat, action!);
          if (!r.ok) throw new Error(`seed ${seed}: bot made an illegal move (${r.error})`);
          m = r.state;
          steps++;
        }
      }
      expect(m.winner, `seed ${seed} after ${m.results.length} hands`).not.toBeNull();
    }
  });
});
