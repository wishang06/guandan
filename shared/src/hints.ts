import type { Card } from './cards';
import { comboStrength, isBomb, sequenceRanks, type Combo, type ComboKey } from './combos';
import { generateLegalPlays, strongestReading } from './generate';

/** Lowest natural rank a combo spends (sequences count from their bottom card). */
export function comboFloor(c: ComboKey): number {
  switch (c.type) {
    case 'straight':
    case 'straightFlush':
      return sequenceRanks(c.rank, 5)[0] === 14 ? 1 : c.rank - 4;
    case 'tube':
      return c.rank - 2;
    case 'plate':
      return c.rank - 1;
    default:
      return c.rank;
  }
}

/**
 * Ordered play suggestions for the hint button: non-bombs before bombs, lowest
 * first; when leading, prefer shedding more cards at the same low rank.
 */
export function suggestPlays(hand: readonly Card[], level: number, current: ComboKey | null): Combo[] {
  const plays = generateLegalPlays(hand, level, current).map((p) => strongestReading(p, level));
  const normal = plays.filter((p) => !isBomb(p));
  const bombs = plays.filter((p) => isBomb(p)).sort((a, b) => comboStrength(a) - comboStrength(b));
  if (current) normal.sort((a, b) => a.rank - b.rank);
  else normal.sort((a, b) => comboFloor(a) - comboFloor(b) || b.size - a.size || a.rank - b.rank);
  return [...normal, ...bombs];
}
