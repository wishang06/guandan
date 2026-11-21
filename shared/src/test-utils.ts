import { makeCardFactory, makeCards, type Card } from './cards';
import { getInterpretations, type Combo } from './combos';

/** Parse cards with a fresh factory so specs can repeat across calls. */
export function cards(specs: string): Card[] {
  return makeCards(specs, makeCardFactory());
}

/** The single interpretation of a card set (throws if there is not exactly one). */
export function one(specs: string, level = 2): Combo {
  const all = getInterpretations(cards(specs), level);
  if (all.length !== 1) {
    throw new Error(`expected 1 interpretation of "${specs}", got ${all.map((c) => `${c.type}:${c.rank}`).join(', ') || 'none'}`);
  }
  return all[0]!;
}

/** Shorthand "type:rank" summaries of all interpretations. */
export function kinds(specs: string, level = 2): string[] {
  return getInterpretations(cards(specs), level).map((c) => `${c.type}:${c.rank}`);
}
