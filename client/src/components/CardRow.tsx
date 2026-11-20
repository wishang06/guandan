import type { Card } from '@guandan/shared';
import { CardFace } from './Card';

/** A compact overlapping row of face-up cards (used for plays on the table). */
export function CardRow({ cards, level, width, highlight }: { cards: Card[]; level: number; width: number; highlight?: boolean }) {
  const step = cards.length > 8 ? width * 0.36 : width * 0.46;
  const total = width + step * (cards.length - 1);
  return (
    <div
      className={`relative ${highlight ? 'drop-shadow-[0_0_10px_rgba(224,176,74,0.55)]' : ''}`}
      style={{ width: total, height: width * 1.4 }}
    >
      {cards.map((c, i) => (
        <CardFace key={c.id} card={c} level={level} width={width} style={{ left: i * step, top: 0 }} />
      ))}
    </div>
  );
}
