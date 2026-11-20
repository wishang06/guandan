import { pendingSeats, type MatchState, type Seat } from './game';
import type { GameView, TributeView } from './protocol';

export interface ViewExtras {
  deadline: number | null;
  nextReady: Seat[];
}

/**
 * Build what one seat (or a spectator, seat = null) may see of a match.
 * Other players' hands are reduced to card counts; return cards are only shown to
 * the two players involved; tribute cards are public once all have been chosen.
 */
export function buildGameView(m: MatchState, seat: Seat | null, extras: ViewExtras): GameView {
  const hand = m.hand;
  let tribute: TributeView | null = null;
  if (hand.tribute) {
    const allPaid = hand.tribute.payments.every((p) => p.card !== null);
    tribute = {
      kind: hand.tribute.kind,
      receivers: [...hand.tribute.receivers],
      payments: hand.tribute.payments.map((p) => ({
        from: p.from,
        to: p.to,
        paid: p.card !== null,
        returned: p.returnCard !== null,
        card: allPaid || seat === p.from ? p.card : null,
        returnCard: seat !== null && (seat === p.from || seat === p.to) ? p.returnCard : null,
      })),
    };
  }
  return {
    handNumber: hand.number,
    level: hand.level,
    declarer: hand.declarer,
    levels: [...m.levels],
    aFails: [...m.aFails],
    phase: hand.phase,
    turn: hand.phase === 'play' ? hand.turn : null,
    leader: hand.leader,
    lastPlay: hand.lastPlay,
    trick: hand.trick,
    cardCounts: hand.hands.map((h) => h.length) as GameView['cardCounts'],
    finishOrder: [...hand.finishOrder],
    myHand: seat === null ? [] : [...hand.hands[seat]!],
    tribute,
    pending: pendingSeats(m),
    deadline: extras.deadline,
    lastResult: m.results[m.results.length - 1] ?? null,
    winner: m.winner,
    events: m.events.slice(-20),
    nextReady: [...extras.nextReady],
  };
}
