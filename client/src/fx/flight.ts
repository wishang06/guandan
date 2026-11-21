import { type Combo, type GameEvent, type Seat } from '@guandan/shared';
import { centerOf, type Point } from './dom';
import { fx } from './engine';
import { planPlay, playTiming } from './plan';
import { fxFull } from './settings';

/**
 * Bookkeeping that lets cards travel between places React renders separately:
 * where each hand card was last drawn, where the seats are, and which game events
 * are new (so reloading mid-game does not replay old animations).
 */

// ---------------------------------------------------------------- freshness

const clock = { lastSeq: Number.POSITIVE_INFINITY };

/** Is this event newer than everything already shown? */
export function isFresh(seq: number): boolean {
  return seq > clock.lastSeq;
}

export function markSeen(seq: number) {
  clock.lastSeq = seq;
}

/**
 * Call when a table first appears. Old history is skipped — unless nothing has
 * happened since the deal, in which case the deal itself is worth animating.
 */
export function primeClock(events: readonly GameEvent[]) {
  const last = events[events.length - 1];
  if (!last) {
    clock.lastSeq = 0;
    return;
  }
  let i = events.length - 1;
  while (i >= 0 && events[i]!.kind === 'antiTribute') i--;
  clock.lastSeq = i >= 0 && events[i]!.kind === 'deal' ? events[i]!.seq - 1 : last.seq;
}

// ---------------------------------------------------------------- anchors

let handNow = new Map<number, DOMRect>();
let handBefore = new Map<number, DOMRect>();

/** Record where every hand card currently is (call after each hand layout). */
export function snapshotHand(container: HTMLElement) {
  handBefore = handNow;
  handNow = new Map();
  container.querySelectorAll<HTMLElement>('[data-card-id]').forEach((el) => {
    handNow.set(Number(el.dataset.cardId), el.getBoundingClientRect());
  });
}

/** Last known on-screen rect of one of your own cards (even if it just left the hand). */
export function handRect(id: number): DOMRect | null {
  return handNow.get(id) ?? handBefore.get(id) ?? null;
}

function pointOf(selector: string): Point | null {
  const el = document.querySelector(selector);
  return el ? centerOf(el.getBoundingClientRect()) : null;
}

export const seatPoint = (seat: Seat): Point | null => pointOf(`[data-seat-anchor="${seat}"]`);
export const trickPoint = (seat: Seat): Point | null => pointOf(`[data-testid="trick-${seat}"]`);
export const tablePoint = (): Point =>
  pointOf('[data-fx-center]') ?? { x: window.innerWidth / 2, y: window.innerHeight * 0.42 };

/**
 * A spot just off the edge of a seat's played cards, on the side facing the middle of
 * the table. `gap` is the clearance between the cards and the callout's centre.
 */
export function calloutPoint(seat: Seat, gap = 44): Point {
  const el = document.querySelector(`[data-testid="trick-${seat}"]`);
  const mid = tablePoint();
  if (!el) return mid;
  const r = el.getBoundingClientRect();
  const slot = centerOf(r);
  const dx = mid.x - slot.x;
  const dy = mid.y - slot.y;
  const len = Math.hypot(dx, dy);
  const g = gap * fx.unit;
  if (len < 40) return { x: slot.x, y: slot.y - r.height / 2 - g };
  const ux = dx / len;
  const uy = dy / len;
  // Distance from the slot's centre to its edge along the push direction.
  const edge = Math.min(Math.abs(ux) > 0.01 ? r.width / 2 / Math.abs(ux) : Infinity, Math.abs(uy) > 0.01 ? r.height / 2 / Math.abs(uy) : Infinity);
  const d = Math.min(edge + g, len);
  return { x: slot.x + ux * d, y: slot.y + uy * d };
}

// ---------------------------------------------------------------- card flights

const FLY_EASE = 'cubic-bezier(0.25, 0.7, 0.2, 1)';

/**
 * Animate freshly rendered trick cards in from where they came from: your own cards
 * from their places in your hand, everyone else's from their seat. Bombs are lifted
 * above the table, hang for a beat, then slam down.
 */
export function launchPlay(root: HTMLElement, combo: Combo, seat: Seat, mine: boolean) {
  if (!fxFull()) return;
  const plan = planPlay(combo);
  const timing = playTiming(plan.tier);
  const seatAt = seatPoint(seat);
  const cards = [...root.querySelectorAll<HTMLElement>('[data-card-id]')];
  const lift = 22 * fx.unit;
  cards.forEach((el, i) => {
    const to = el.getBoundingClientRect();
    const own = mine ? handRect(Number(el.dataset.cardId)) : null;
    const from = own ? centerOf(own) : seatAt;
    if (!from) return;
    const dx = from.x - (to.left + to.width / 2);
    const dy = from.y - (to.top + to.height / 2);
    const s0 = own ? own.width / to.width : 0.4;
    const r0 = own ? 0 : (i - (cards.length - 1) / 2) * 9;
    const start = `translate(${dx}px, ${dy}px) scale(${s0}) rotate(${r0}deg)`;
    // Effect easing stays linear so the keyframe offsets are real times (impact lands
    // exactly when the director fires its sparks); each segment eases on its own.
    const frames: Keyframe[] =
      plan.tier >= 2
        ? [
            { transform: start, opacity: own ? 1 : 0.5, offset: 0, easing: FLY_EASE },
            { transform: `translate(0, ${-lift}px) scale(1.3) rotate(-3deg)`, opacity: 1, offset: 0.45, easing: 'ease-in-out' },
            { transform: `translate(0, ${-lift * 1.3}px) scale(1.36) rotate(2deg)`, opacity: 1, offset: 0.8, easing: 'cubic-bezier(0.7, 0, 1, 0.6)' },
            { transform: 'translate(0, 3px) scale(1.1, 0.88)', opacity: 1, offset: 0.92, easing: 'ease-out' },
            { transform: 'none', opacity: 1, offset: 1 },
          ]
        : [
            { transform: start, opacity: own ? 1 : 0.5, offset: 0, easing: FLY_EASE },
            { transform: 'translate(0, -7px) scale(1.07)', opacity: 1, offset: 0.7, easing: 'ease-in' },
            { transform: 'translate(0, 1px) scale(1.03, 0.95)', opacity: 1, offset: 0.9, easing: 'ease-out' },
            { transform: 'none', opacity: 1, offset: 1 },
          ];
    el.animate(frames, { duration: timing.fly, delay: i * timing.stagger, easing: 'linear', fill: 'backwards' });
    if (plan.ripple) {
      el.animate([{ transform: 'none' }, { transform: `translateY(${-11 * fx.unit}px)` }, { transform: 'none' }], {
        duration: 280,
        delay: timing.fly + 60 + i * 55,
        easing: 'ease-out',
      });
    }
  });
}
