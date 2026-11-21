import { describe, expect, it } from 'vitest';
import type { ComboKey, ComboType } from '@guandan/shared';
import { planPlay, playTiming, tierOf } from './plan';
import { shakeOffset } from './shake';
import { FxEngine } from './engine';

const k = (type: ComboType, size: number, rank = 9): ComboKey => ({ type, size, rank });

describe('effect planning', () => {
  it('keeps routine plays quiet', () => {
    for (const c of [k('single', 1), k('pair', 2), k('triple', 3)]) {
      const p = planPlay(c);
      expect(p.tier).toBe(0);
      expect(p.glyphs).toBeNull();
      expect(p.shake + p.sparks + p.ink + p.flash).toBe(0);
    }
  });

  it('names the mid-size combos without shaking the table', () => {
    expect(planPlay(k('fullHouse', 5))).toMatchObject({ tier: 1, glyphs: '三带二', shake: 0, ripple: false });
    expect(planPlay(k('straight', 5))).toMatchObject({ tier: 1, glyphs: '顺子', ripple: true });
    expect(planPlay(k('tube', 6))).toMatchObject({ tier: 1, glyphs: '木板', ripple: true });
    expect(planPlay(k('plate', 6))).toMatchObject({ tier: 1, glyphs: '钢板' });
  });

  it('escalates bombs in the same order the rules rank them', () => {
    const ladder = [k('bomb', 4), k('bomb', 5), k('bomb', 6), k('bomb', 7), k('bomb', 8), k('bomb', 10), k('jokerBomb', 4)];
    const shakes = ladder.map((c) => planPlay(c).shake);
    const sparks = ladder.map((c) => planPlay(c).sparks);
    for (let i = 1; i < ladder.length; i++) {
      expect(shakes[i]!).toBeGreaterThanOrEqual(shakes[i - 1]!);
      expect(sparks[i]!).toBeGreaterThanOrEqual(sparks[i - 1]!);
    }
    expect(tierOf(k('bomb', 4))).toBe(2);
    expect(tierOf(k('bomb', 6))).toBe(3);
    expect(tierOf(k('straightFlush', 5))).toBe(3);
    expect(tierOf(k('bomb', 7))).toBe(4);
    expect(tierOf(k('jokerBomb', 4))).toBe(5);
    expect(planPlay(k('jokerBomb', 4)).glyphs).toBe('天王炸');
  });

  it('never flashes brighter than a single soft pulse', () => {
    for (const c of [k('bomb', 4), k('bomb', 10), k('straightFlush', 5), k('jokerBomb', 4)]) {
      expect(planPlay(c).flash).toBeLessThanOrEqual(0.55);
    }
  });

  it('lets bombs hang in the air before impact', () => {
    expect(playTiming(0).fly).toBeLessThan(playTiming(2).fly);
    for (const t of [0, 1, 2, 3, 4, 5] as const) expect(playTiming(t).impact).toBeLessThanOrEqual(playTiming(t).fly);
  });
});

describe('screen shake', () => {
  it('scales with trauma squared and stays within bounds', () => {
    for (let t = 0; t < 3; t += 0.013) {
      const full = shakeOffset(1, t);
      const half = shakeOffset(0.5, t);
      expect(Math.abs(full.x)).toBeLessThanOrEqual(13.001);
      expect(Math.abs(full.y)).toBeLessThanOrEqual(13.001);
      expect(Math.abs(full.r)).toBeLessThanOrEqual(0.801);
      expect(half.x).toBeCloseTo(full.x / 4, 6);
    }
    const still = shakeOffset(0, 1.23);
    expect(Math.abs(still.x) + Math.abs(still.y) + Math.abs(still.r)).toBe(0);
  });
});

describe('effects engine', () => {
  function seeded() {
    let s = 42;
    return new FxEngine(() => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    });
  }

  it('every effect finishes on its own', () => {
    const e = seeded();
    e.width = 390;
    e.height = 800;
    e.burst(100, 100, { count: 40 });
    e.ring(100, 100, { radius: 80 });
    e.ink(100, 100, 70);
    e.brush(20, 300, 300, 300);
    e.lightning(200, 400);
    e.dust(100, 100);
    e.embers(100, 100, 12);
    e.confettiBurst(200, 400, 30);
    e.confettiRain(30);
    e.rocket(200, 200);
    expect(e.count).toBeGreaterThan(100);
    let steps = 0;
    while (e.count > 0 && steps < 60 * 12) {
      e.step(1 / 60);
      steps++;
    }
    expect(e.count).toBe(0);
  });

  it('a rocket bursts into sparks when it reaches its apex', () => {
    const e = seeded();
    e.width = 390;
    e.height = 800;
    e.rocket(200, 250);
    let peak = 0;
    for (let i = 0; i < 60 * 3; i++) {
      e.step(1 / 60);
      peak = Math.max(peak, e.count);
    }
    expect(peak).toBeGreaterThan(50);
  });

  it('caps spark count so a pile-up cannot stall a phone', () => {
    const e = seeded();
    for (let i = 0; i < 30; i++) e.burst(0, 0, { count: 100 });
    expect(e.count).toBeLessThanOrEqual(e.budget);
  });
});
