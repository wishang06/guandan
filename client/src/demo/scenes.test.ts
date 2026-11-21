import { describe, expect, it } from 'vitest';
import { SCENES } from './scenes';

describe('effects preview scenes', () => {
  it('have unique ids and both languages', () => {
    expect(new Set(SCENES.map((s) => s.id)).size).toBe(SCENES.length);
    for (const s of SCENES) {
      expect(s.en.length).toBeGreaterThan(3);
      expect(s.zh.length).toBeGreaterThan(1);
    }
  });

  it.each(SCENES.map((s) => [s.id, s] as const))('%s: every scripted move is legal', (_id, scene) => {
    const { match, script } = scene.build();
    let m = match;
    script.forEach((step, i) => {
      const next = step.run(m);
      expect(next, `step ${i + 1} was rejected`).not.toBe(m);
      m = next;
    });
    const ids = m.hand.hands.flat().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the scenes reach the moments they advertise', () => {
    const end = (id: string) => {
      const scene = SCENES.find((s) => s.id === id)!;
      const { match, script } = scene.build();
      return script.reduce((m, step) => step.run(m), match);
    };
    expect(end('jokers').hand.lastPlay?.combo.type).toBe('jokerBomb');
    expect(end('flush').hand.lastPlay?.combo.type).toBe('straightFlush');
    expect(end('bomb8').hand.lastPlay?.combo).toMatchObject({ type: 'bomb', size: 8 });
    expect(end('bombs').hand.lastPlay?.combo).toMatchObject({ type: 'bomb', size: 6 });
    expect(end('jiefeng').events.some((e) => e.kind === 'jiefeng' && e.seat === 0)).toBe(true);
    expect(end('win').results.at(-1)).toMatchObject({ winningTeam: 0, partnerPlace: 2, levelGain: 3 });
    expect(end('lose').results.at(-1)).toMatchObject({ winningTeam: 1 });
    expect(end('match').winner).toBe(0);
    expect(end('anti').hand.tribute?.kind).toBe('anti');
    expect(end('tributeIn').hand.phase).toBe('play');
    expect(end('tributeOut').hand.phase).toBe('play');
    expect(end('alerts').hand.hands[1]).toHaveLength(5);
  });
});
