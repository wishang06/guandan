import { useLayoutEffect, useRef } from 'react';
import type { Card, Combo, Seat } from '@guandan/shared';
import { captureGhost } from '../fx/dom';
import { isFresh, launchPlay } from '../fx/flight';
import { displayCards } from '../lib/cards';
import { CardFace } from './Card';

/** A compact overlapping row of face-up cards (used for plays on the table). */
export function CardRow({ cards, level, width, highlight }: { cards: Card[]; level: number; width: number; highlight?: boolean }) {
  const step = cards.length > 8 ? width * 0.36 : width * 0.46;
  const total = width + step * (cards.length - 1);
  return (
    <div
      className={`relative ${highlight ? 'top-play' : ''}`}
      style={{ width: total, height: width * 1.4 }}
    >
      {cards.map((c, i) => (
        <CardFace key={c.id} card={c} level={level} width={width} style={{ left: i * step, top: 0 }} />
      ))}
    </div>
  );
}

interface TrickPlayProps {
  combo: Combo;
  seat: Seat;
  /** Sequence number of the play event — new plays fly in, old ones just appear. */
  seq: number;
  level: number;
  width: number;
  highlight?: boolean;
  mine: boolean;
}

/**
 * One seat's cards on the table. On arrival the cards fly in from the hand or the
 * seat; when React removes them a ghost is kept so the trick can be swept away.
 */
export function TrickPlay({ combo, seat, seq, level, width, highlight, mine }: TrickPlayProps) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    if (isFresh(seq)) launchPlay(root, combo, seat, mine);
    return () => captureGhost(root);
    // Mount/unmount only: the component is keyed by seat and seq.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div ref={ref}>
      <CardRow cards={displayCards(combo)} level={level} width={width} highlight={highlight} />
    </div>
  );
}
