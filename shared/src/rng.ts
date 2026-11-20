/**
 * Small deterministic PRNG (mulberry32). The state is a single uint32 so it can
 * live inside serialisable game state and be replayed in tests.
 */
export function nextRandom(state: number): [value: number, nextState: number] {
  let t = (state + 0x6d2b79f5) >>> 0;
  const next = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, next];
}

/** Fisher–Yates shuffle driven by {@link nextRandom}. Returns the shuffled copy and the new RNG state. */
export function shuffle<T>(items: readonly T[], state: number): [T[], number] {
  const out = items.slice();
  let s = state;
  for (let i = out.length - 1; i > 0; i--) {
    const [r, ns] = nextRandom(s);
    s = ns;
    const j = Math.floor(r * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return [out, s];
}

export function randomInt(maxExclusive: number, state: number): [number, number] {
  const [r, s] = nextRandom(state);
  return [Math.floor(r * maxExclusive), s];
}

export function randomSeed(): number {
  return (Math.random() * 4294967296) >>> 0;
}
