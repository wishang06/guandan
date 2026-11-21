import { useSyncExternalStore } from 'react';
import { KEYS, load, save } from '../lib/storage';

/**
 * How much motion the player wants.
 * - full: card flights, particles, screen shake, flashes, haptics.
 * - reduced: state changes are still shown, but with plain fades and no shake/flash.
 */
export type FxLevel = 'full' | 'reduced';

const prefersReduced = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

let level: FxLevel = load<FxLevel | null>(KEYS.fx, null) ?? (prefersReduced() ? 'reduced' : 'full');
const listeners = new Set<() => void>();

function apply() {
  if (typeof document !== 'undefined') document.documentElement.dataset.fx = level;
}
apply();

export function getFxLevel(): FxLevel {
  return level;
}

/** True when full effects are enabled. */
export function fxFull(): boolean {
  return level === 'full';
}

export function setFxLevel(next: FxLevel) {
  level = next;
  save(KEYS.fx, next);
  apply();
  listeners.forEach((l) => l());
}

export function useFxLevel(): FxLevel {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => level,
  );
}
