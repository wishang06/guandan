import { fxFull } from './settings';

/** Vibrate on devices that support it (Android). A no-op elsewhere, including iOS. */
export function buzz(pattern: number | number[]) {
  if (!fxFull() || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // ignore
  }
}
