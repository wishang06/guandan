import { useMemo, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import type { Card } from '@guandan/shared';
import { groupHand } from '../lib/cards';
import { clamp, useElementWidth, useViewport } from '../lib/useViewport';
import { CardFace } from './Card';

interface HandProps {
  cards: Card[];
  level: number;
  selected: ReadonlySet<number>;
  onSelect: (ids: number[], on: boolean) => void;
  /** Only these cards can be picked; the rest are dimmed. */
  eligible?: ReadonlySet<number> | null;
  /** Tap selects a single card (no swipe). */
  single?: boolean;
  disabled?: boolean;
}

interface Placed {
  card: Card;
  x: number;
  y: number;
  angle: number;
  z: number;
}

/**
 * The player's hand, fanned along a shallow arc. Two overlapping rows in portrait,
 * one row in landscape. Tap a card to toggle it, or drag across cards to select a run.
 */
export function Hand({ cards, level, selected, onSelect, eligible, single, disabled }: HandProps) {
  const [measure, width] = useElementWidth<HTMLDivElement>();
  const container = useRef<HTMLDivElement | null>(null);
  const vp = useViewport();
  const drag = useRef<{ on: boolean; seen: Set<number> } | null>(null);

  const layout = useMemo(() => {
    const W = Math.max(width, 200);
    const groups = groupHand(cards, level);
    const flat = groups.flatMap((g, gi) => g.cards.map((card) => ({ card, gi })));
    const twoRows = vp.portrait && flat.length > 12;
    const cw = vp.portrait ? clamp(W / 6.8, 40, 68) : clamp(Math.min(vp.h * 0.15, W / 11), 38, 76);
    const ch = cw * 1.4;
    const lift = cw * 0.32;

    let rows = [flat];
    if (twoRows) {
      const target = Math.ceil(flat.length / 2);
      let split = target;
      for (let d = 0; d <= 3; d++) {
        const a = target - d;
        const b = target + d;
        if (a > 0 && flat[a]?.gi !== flat[a - 1]?.gi) {
          split = a;
          break;
        }
        if (b < flat.length && flat[b]?.gi !== flat[b - 1]?.gi) {
          split = b;
          break;
        }
      }
      rows = [flat.slice(0, split), flat.slice(split)];
    }

    const placed: Placed[] = [];
    let z = 0;
    rows.forEach((row, ri) => {
      const n = row.length;
      if (n === 0) return;
      const breaks = row.reduce((k, item, i) => k + (i > 0 && item.gi !== row[i - 1]!.gi ? 1 : 0), 0);
      let gap = cw * 0.16;
      let step = n > 1 ? Math.min(cw * 0.62, (W - cw - breaks * gap) / (n - 1)) : 0;
      if (step < cw * 0.26 && breaks > 0) {
        gap = 0;
        step = n > 1 ? Math.min(cw * 0.62, (W - cw) / (n - 1)) : 0;
      }
      const total = cw + step * (n - 1) + breaks * gap;
      let x = (W - total) / 2;
      const rowTop = lift + ri * ch * 0.52;
      row.forEach((item, i) => {
        if (i > 0) x += step + (item.gi !== row[i - 1]!.gi ? gap : 0);
        const centre = (x + cw / 2 - W / 2) / (W / 2); // −1 … 1
        placed.push({
          card: item.card,
          x,
          y: rowTop + centre * centre * cw * 0.14,
          angle: centre * (twoRows ? 3 : 5),
          z: z++,
        });
      });
    });
    const height = lift + ch + (rows.length - 1) * ch * 0.52 + cw * 0.16;
    return { placed, cw, height, lift };
  }, [cards, level, width, vp.portrait, vp.h]);

  const idAt = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y)?.closest('[data-card-id]');
    if (!el || !container.current?.contains(el)) return null;
    return Number(el.getAttribute('data-card-id'));
  };

  const canPick = (id: number) => !disabled && (!eligible || eligible.has(id));

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const id = idAt(e.clientX, e.clientY);
    if (id === null || !canPick(id)) return;
    const on = single ? true : !selected.has(id);
    drag.current = { on, seen: new Set([id]) };
    onSelect([id], on);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || single) return;
    const id = idAt(e.clientX, e.clientY);
    if (id === null || d.seen.has(id) || !canPick(id)) return;
    d.seen.add(id);
    onSelect([id], d.on);
  };

  const end = () => {
    drag.current = null;
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>, id: number) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    if (canPick(id)) onSelect([id], single ? true : !selected.has(id));
  };

  return (
    <div
      ref={(el) => {
        container.current = el;
        measure(el);
      }}
      className="relative w-full select-none touch-none"
      style={{ height: layout.height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      data-testid="hand"
    >
      {layout.placed.map((p) => {
        const sel = selected.has(p.card.id);
        return (
          <CardFace
            key={p.card.id}
            card={p.card}
            level={level}
            width={layout.cw}
            selected={sel}
            dim={!!eligible && !eligible.has(p.card.id)}
            tabIndex={disabled ? -1 : 0}
            onKeyDown={(e) => onKey(e, p.card.id)}
            style={{
              left: p.x,
              top: p.y,
              zIndex: p.z,
              transform: `rotate(${p.angle}deg) translateY(${sel ? -layout.lift : 0}px)`,
              transformOrigin: '50% 120%',
            }}
          />
        );
      })}
    </div>
  );
}
