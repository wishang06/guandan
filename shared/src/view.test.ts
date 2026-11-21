import { describe, expect, it } from 'vitest';
import { makeCardFactory, makeCards } from './cards';
import { applyAction, createMatch, startNextHand, type MatchState } from './game';
import { buildGameView } from './view';

function act(m: MatchState, seat: 0 | 1 | 2 | 3, cardId: number, type: 'tribute' | 'return'): MatchState {
  const r = applyAction(m, seat, { type, cardId });
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

describe('buildGameView', () => {
  it('shows your hand and only counts for others', () => {
    const m = createMatch({ seed: 3 });
    const v = buildGameView(m, 2, { deadline: null, nextReady: [] });
    expect(v.myHand).toEqual(m.hand.hands[2]);
    expect(v.cardCounts).toEqual([27, 27, 27, 27]);
    expect(buildGameView(m, null, { deadline: null, nextReady: [] }).myHand).toEqual([]);
  });

  it('reveals tribute cards once all are paid and return cards only to the pair involved', () => {
    const f = makeCardFactory();
    const first = ['S3', 'S4', 'S5', 'S9 S10'].map((s) => makeCards(s, f));
    let m = createMatch({ hands: first, firstLeader: 0 });
    for (const [seat, i] of [
      [0, 0],
      [1, 0],
      [2, 0],
    ] as const) {
      const r = applyAction(m, seat, { type: 'play', cardIds: [m.hand.hands[seat]![i]!.id] });
      if (!r.ok) throw new Error(r.error);
      m = r.state;
    }
    const g = makeCardFactory();
    m = startNextHand(m, { hands: ['S5 S6', 'D3', 'C3', 'SK S3'].map((s) => makeCards(s, g)) });
    expect(buildGameView(m, 1, { deadline: null, nextReady: [] }).tribute!.payments[0]!.card).toBeNull();
    m = act(m, 3, m.hand.hands[3]!.find((c) => c.rank === 13)!.id, 'tribute');
    expect(buildGameView(m, 1, { deadline: null, nextReady: [] }).tribute!.payments[0]!.card?.rank).toBe(13);
    m = act(m, 0, m.hand.hands[0]!.find((c) => c.rank === 5)!.id, 'return');
    expect(buildGameView(m, 1, { deadline: null, nextReady: [] }).tribute!.payments[0]!.returnCard).toBeNull();
    expect(buildGameView(m, 3, { deadline: null, nextReady: [] }).tribute!.payments[0]!.returnCard?.rank).toBe(5);
    expect(buildGameView(m, 0, { deadline: null, nextReady: [] }).tribute!.payments[0]!.returnCard?.rank).toBe(5);
  });
});
