import { fxFull } from './settings';

/**
 * Trauma-based screen shake: effects add "trauma" (0..1), the visible shake is
 * trauma², driven by smooth noise rather than random jitter, and it decays linearly.
 */
const MAX_OFFSET = 13; // px at full trauma
const MAX_ROTATION = 0.8; // degrees at full trauma
const DECAY = 1.9; // trauma per second

let target: HTMLElement | null = null;
let trauma = 0;
let raf = 0;
let last = 0;
let time = 0;

/** Cheap smooth noise in −1..1 (a few detuned sines). */
function noise(t: number, seed: number): number {
  return Math.sin(t + seed * 12.9) * 0.6 + Math.sin(t * 2.3 + seed * 78.2) * 0.3 + Math.sin(t * 4.1 + seed * 3.7) * 0.1;
}

/** Offset for a given trauma and time — pure, so it can be tested. */
export function shakeOffset(amount: number, t: number): { x: number; y: number; r: number } {
  const s = amount * amount;
  return {
    x: MAX_OFFSET * s * noise(t * 34, 1),
    y: MAX_OFFSET * s * noise(t * 34, 2),
    r: MAX_ROTATION * s * noise(t * 27, 3),
  };
}

export function setShakeTarget(el: HTMLElement | null) {
  if (target && target !== el) target.style.transform = '';
  target = el;
}

function frame(now: number) {
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
  last = now;
  time += dt;
  trauma = Math.max(0, trauma - DECAY * dt);
  if (!target || trauma <= 0) {
    if (target) {
      target.style.transform = '';
      target.style.willChange = '';
    }
    raf = 0;
    last = 0;
    return;
  }
  const { x, y, r } = shakeOffset(trauma, time);
  target.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${r.toFixed(3)}deg)`;
  raf = requestAnimationFrame(frame);
}

/** Add trauma (0..1). Several hits in a row stack, capped at 1. */
export function shake(amount: number) {
  if (!fxFull() || !target || typeof requestAnimationFrame !== 'function') return;
  trauma = Math.min(1, trauma + amount);
  if (!raf) {
    target.style.willChange = 'transform'; // own layer for the duration of the shake
    raf = requestAnimationFrame(frame);
  }
}
