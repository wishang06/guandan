import { useLayoutEffect, useMemo, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import type { Card } from '@guandan/shared';
import { centerOf, type Point } from '../fx/dom';
import { isFresh, snapshotHand, tablePoint } from '../fx/flight';
import { buzz } from '../fx/haptics';
import { fxFull } from '../fx/settings';
import { groupHand } from '../lib/cards';
import { playSound } from '../lib/sound';
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
  /** Sequence number of the latest deal; a new one deals the hand in from the deck. */
  dealSeq?: number;
  /** Where a newly arrived card (tribute, return) flies in from. */
  arrivalFrom?: () => Point | null;
  /** Lift order for cards selected together (the hint), so they rise as a wave. */
  wave?: ReadonlyMap<number, number>;
}

interface Placed {
  card: Card;
  x: number;
  y: number;
  angle: number;
  z: number;
}

const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

/** Deal every card in from the deck, face down, then turn them over in a wave. */
function dealIn(root: HTMLElement) {
  const deck = tablePoint();
  root.querySelectorAll<HTMLElement>('.hand-flight').forEach((el, i) => {
    const c = centerOf(el.getBoundingClientRect());
    const delay = i * 28;
    const flyTime = 400;
    el.animate(
      [
        { transform: `translate(${deck.x - c.x}px, ${deck.y - c.y}px) scale(0.45) rotate(${i % 2 ? 24 : -24}deg)`, opacity: 0 },
        { opacity: 1, offset: 0.12 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: flyTime, delay, easing: EASE, fill: 'backwards' },
    );
    const card = el.firstElementChild as HTMLElement | null;
    if (!card) return;
    const back = document.createElement('div');
    back.className = 'card-back card-flipback';
    card.appendChild(back);
    const flipAt = delay + flyTime + 60;
    const flipTime = 260;
    el.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0.03)' }, { transform: 'scaleX(1)' }], {
      duration: flipTime,
      delay: flipAt,
      easing: 'ease-in-out',
    });
    const remove = () => back.remove();
    back.animate([{ opacity: 1 }, { opacity: 1 }], { duration: flipAt + flipTime / 2 }).finished.then(remove, remove);
  });
}

/** Fly newly received cards in from another seat and let them glow for a moment. */
function arrive(root: HTMLElement, ids: number[], from: Point) {
  for (const id of ids) {
    const card = root.querySelector<HTMLElement>(`[data-card-id="${id}"]`);
    const flight = card?.parentElement;
    if (!card || !flight) continue;
    const c = centerOf(flight.getBoundingClientRect());
    // Stay hidden while the director's card is still crossing the table, then drop in.
    const wait = 720;
    flight.animate(
      [
        { transform: `translate(${from.x - c.x}px, ${from.y - c.y}px) scale(0.8) rotate(8deg)`, opacity: 0, offset: 0 },
        { opacity: 1, offset: 0.05 },
        { transform: `translate(${(from.x - c.x) * 0.2}px, ${(from.y - c.y) * 0.2 - 18}px) scale(1.18) rotate(-3deg)`, opacity: 1, offset: 0.6 },
        { transform: 'none', opacity: 1, offset: 1 },
      ],
      { duration: 460, delay: wait, easing: EASE, fill: 'backwards' },
    );
    card.animate(
      [
        { boxShadow: '0 0 0 3px #f0d58e, 0 0 26px 8px rgb(240 213 142 / 0.9)' },
        { boxShadow: '0 0 0 3px #f0d58e, 0 0 26px 8px rgb(240 213 142 / 0.9)', offset: 0.7 },
        { boxShadow: '0 0 0 0 rgb(240 213 142 / 0), 0 0 0 0 rgb(240 213 142 / 0)' },
      ],
      { duration: 2600, delay: wait },
    );
  }
}

/**
 * The player's hand, fanned along a shallow arc. Two overlapping rows in portrait,
 * one row in landscape. Tap a card to toggle it, or drag across cards to select a run.
 * Cards glide to close the gaps when some are played.
 */
export function Hand({ cards, level, selected, onSelect, eligible, single, disabled, dealSeq, arrivalFrom, wave }: HandProps) {
  const [measure, width] = useElementWidth<HTMLDivElement>();
  const container = useRef<HTMLDivElement | null>(null);
  const vp = useViewport();
  const drag = useRef<{ on: boolean; seen: Set<number> } | null>(null);
  const known = useRef<Set<number>>(new Set());
  const dealt = useRef<number | undefined>(undefined);
  const dealPending = useRef(false);

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

  // Entrances: a fresh deal flies in from the deck; a tribute card arrives from its giver.
  useLayoutEffect(() => {
    // Note a new deal as soon as it is seen: by the time the hand has been measured
    // (one render later on first mount) the event is no longer "fresh".
    if (dealSeq !== dealt.current) {
      dealt.current = dealSeq;
      dealPending.current = dealSeq !== undefined && isFresh(dealSeq);
    }
    const root = container.current;
    if (!root || width === 0) return;
    const before = known.current;
    const added = cards.filter((c) => !before.has(c.id)).map((c) => c.id);
    known.current = new Set(cards.map((c) => c.id));
    if (fxFull() && added.length > 0) {
      if (dealPending.current && added.length >= 12) {
        dealIn(root);
      } else if (before.size > 0 && added.length <= 2) {
        const from = arrivalFrom?.();
        if (from) arrive(root, added, from);
      }
    }
    if (added.length > 0) dealPending.current = false;
    snapshotHand(root);
  });

  const idAt = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y)?.closest('[data-card-id]');
    if (!el || !container.current?.contains(el)) return null;
    return Number(el.getAttribute('data-card-id'));
  };

  const canPick = (id: number) => !disabled && (!eligible || eligible.has(id));

  const pick = (id: number, on: boolean) => {
    onSelect([id], on);
    playSound(on ? 'select' : 'deselect');
    buzz(6);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const id = idAt(e.clientX, e.clientY);
    if (id === null || !canPick(id)) return;
    const on = single ? true : !selected.has(id);
    drag.current = { on, seen: new Set([id]) };
    pick(id, on);
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
    pick(id, d.on);
  };

  const end = () => {
    drag.current = null;
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>, id: number) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    if (canPick(id)) pick(id, single ? true : !selected.has(id));
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
      {width > 0 &&
        layout.placed.map((p) => {
          const sel = selected.has(p.card.id);
          const order = sel ? wave?.get(p.card.id) : undefined;
          return (
            <div key={p.card.id} className="hand-slot" style={{ transform: `translate3d(${p.x}px, ${p.y}px, 0)`, zIndex: p.z }}>
              <div className="hand-flight">
                <CardFace
                  card={p.card}
                  level={level}
                  width={layout.cw}
                  selected={sel}
                  dim={!!eligible && !eligible.has(p.card.id)}
                  tabIndex={disabled ? -1 : 0}
                  onKeyDown={(e) => onKey(e, p.card.id)}
                  style={{
                    transform: `rotate(${p.angle}deg) translateY(${sel ? -layout.lift : 0}px)`,
                    transitionDelay: order !== undefined ? `${order * 28}ms` : undefined,
                  }}
                />
              </div>
            </div>
          );
        })}
    </div>
  );
}
