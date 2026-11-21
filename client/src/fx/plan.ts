import type { ComboKey, ComboType } from '@guandan/shared';

/**
 * How loud a play should be. Routine plays stay quiet so the cards remain readable;
 * the rare ones get a set-piece.
 *
 * 0  single / pair / triple            — fly in, soft thud
 * 1  full house, straight, tube, plate — plus a small brushed name
 * 2  bomb of 4 or 5                    — lift, slam, ink, seal
 * 3  bomb of 6, straight flush         — bigger slam, embers / gold stroke
 * 4  bomb of 7 or more                 — heavy slam, flash
 * 5  four jokers                       — the sky cracks
 */
export type Tier = 0 | 1 | 2 | 3 | 4 | 5;

export interface PlayPlan {
  tier: Tier;
  type: ComboType;
  /** Brush glyphs for the callout (always Chinese; captions carry the translation). */
  glyphs: string | null;
  /** Screen-shake trauma added on impact. */
  shake: number;
  sparks: number;
  /** Ink blot radius in px (before scaling), 0 for none. */
  ink: number;
  rings: number;
  embers: number;
  /** Peak opacity of the impact flash, 0 for none. */
  flash: number;
  /** Cards hop one after another once landed (runs of consecutive ranks). */
  ripple: boolean;
}

const GLYPHS: Partial<Record<ComboType, string>> = {
  fullHouse: '三带二',
  straight: '顺子',
  tube: '木板',
  plate: '钢板',
  bomb: '炸',
  straightFlush: '同花顺',
  jokerBomb: '天王炸',
};

export function tierOf(c: ComboKey): Tier {
  switch (c.type) {
    case 'jokerBomb':
      return 5;
    case 'straightFlush':
      return 3;
    case 'bomb':
      return c.size >= 7 ? 4 : c.size === 6 ? 3 : 2;
    case 'fullHouse':
    case 'straight':
    case 'tube':
    case 'plate':
      return 1;
    default:
      return 0;
  }
}

export function planPlay(c: ComboKey): PlayPlan {
  const tier = tierOf(c);
  const base = { tier, type: c.type, glyphs: GLYPHS[c.type] ?? null, ripple: false, embers: 0, flash: 0, rings: 0, ink: 0, sparks: 0, shake: 0 };
  const run = c.type === 'straight' || c.type === 'tube' || c.type === 'plate' || c.type === 'straightFlush';
  switch (tier) {
    case 0:
      return base;
    case 1:
      return { ...base, ripple: run, sparks: c.type === 'plate' ? 10 : 0 };
    case 2:
      return { ...base, shake: c.size === 5 ? 0.5 : 0.42, sparks: c.size === 5 ? 30 : 22, ink: c.size === 5 ? 74 : 64, rings: 1 };
    case 3:
      return c.type === 'straightFlush'
        ? { ...base, shake: 0.5, sparks: 40, ink: 0, rings: 1, ripple: true, flash: 0.18 }
        : { ...base, shake: 0.66, sparks: 46, ink: 92, rings: 2, embers: 12, flash: 0.22 };
    case 4:
      return { ...base, shake: 0.85, sparks: 70 + (c.size - 7) * 12, ink: 116, rings: 3, embers: 26, flash: 0.38 };
    default:
      return { ...base, shake: 1, sparks: 110, ink: 150, rings: 3, embers: 34, flash: 0.55 };
  }
}

/** Flight length and the moment of impact, in ms. Bombs hang in the air before the slam. */
export function playTiming(tier: Tier): { fly: number; impact: number; stagger: number } {
  if (tier >= 2) return { fly: 640, impact: 590, stagger: 22 };
  return { fly: 320, impact: 290, stagger: 26 };
}
