import {
  partnerOf,
  rankLabel,
  teamOf,
  type Card,
  type Combo,
  type GameEvent,
  type HandResult,
  type Seat,
} from '@guandan/shared';
import { makeCardEl } from '../components/Card';
import type { Lang, MessageKey, Translate } from '../i18n';
import { playSound } from '../lib/sound';
import { brushText, cardBackEl, dim, flash, floatText, fly, releaseGhosts, seal, type Point } from './dom';
import { fx, PALETTE } from './engine';
import { calloutPoint, seatPoint, tablePoint, trickPoint } from './flight';
import { buzz } from './haptics';
import { planPlay, playTiming, type PlayPlan } from './plan';
import { fxFull } from './settings';
import { shake } from './shake';

/**
 * The director turns game events into staged moments: what flies, what stamps, what
 * shakes, and when. It owns no state beyond its pending timers.
 */
export interface DirectorCtx {
  me: Seat;
  level: number;
  lang: Lang;
  t: Translate;
  nameOf: (seat: Seat) => string;
  /** Result of the hand that just ended (for hand-end staging). */
  result: HandResult | null;
}

const timers = new Set<number>();

function after(ms: number, fn: () => void) {
  const id = window.setTimeout(() => {
    timers.delete(id);
    fn();
  }, ms);
  timers.add(id);
}

/** Cancel everything still queued (table gone, new scene). */
export function cancelDirector() {
  timers.forEach((id) => clearTimeout(id));
  timers.clear();
  fx.clear();
}

let tables = 0;

/**
 * Called by a mounted table; the returned function releases it. Queued effects are
 * cancelled only once no table is left — so React's dev-mode double mount, or one
 * table replacing another, does not wipe effects that were just scheduled.
 */
export function retainDirector(): () => void {
  tables += 1;
  return () => {
    tables -= 1;
    window.setTimeout(() => {
      if (tables === 0) cancelDirector();
    }, 60);
  };
}

const PLACE_GLYPHS = ['上游', '二游', '三游', '下游'] as const;
const PLACE_KEYS: MessageKey[] = ['place1', 'place2', 'place3', 'place4'];

/** Stage a batch of new events (everything that arrived in one state update). */
export function runEvents(events: readonly GameEvent[], ctx: DirectorCtx) {
  const trickCleared = events.some((e) => e.kind === 'trickWon' || e.kind === 'jiefeng' || e.kind === 'handEnd');
  for (const e of events) {
    switch (e.kind) {
      case 'deal':
        onDeal(ctx);
        break;
      case 'play':
        if (e.seat !== undefined && e.combo) onPlay(e.seat, e.combo, ctx);
        break;
      case 'pass':
        playSound('pass');
        // The pass pill is cleared with the trick, so show a passing bubble instead.
        if (trickCleared && e.seat !== undefined) {
          const p = trickPoint(e.seat);
          if (p) floatText(ctx.t('passed'), { ...p, size: 15, color: 'rgb(247 243 232 / 0.85)' });
        }
        break;
      case 'finish':
        if (e.seat !== undefined && e.place) onFinish(e.seat, e.place, ctx);
        break;
      case 'trickWon':
        if (e.seat !== undefined) {
          const p = seatPoint(e.seat);
          after(260, () => releaseGhosts(p));
        }
        break;
      case 'jiefeng':
        if (e.seat !== undefined) onJiefeng(e.seat, ctx);
        break;
      case 'tribute':
        if (e.seat !== undefined && e.to !== undefined && e.card) onTribute(e.seat, e.to, e.card, ctx);
        break;
      case 'return':
        if (e.seat !== undefined && e.to !== undefined) onReturn(e.seat, e.to);
        break;
      case 'antiTribute':
        // Wait for the deal and the level announcement when they share the stage.
        after(events.some((x) => x.kind === 'deal') ? 3100 : 600, () => {
          const c = tablePoint();
          seal('抗贡', { x: c.x, y: c.y - 34 * fx.unit, size: 60 * fx.unit, caption: ctx.lang === 'en' ? ctx.t('fx_anti') : undefined, hold: 1300 });
          playSound('stamp');
          playSound('gong', { delay: 0.05 });
          shake(0.35);
          fx.ring(c.x, c.y, { radius: 150 * fx.unit, color: PALETTE.cinnabarLight });
        });
        break;
      case 'handEnd':
        onHandEnd(ctx);
        break;
      case 'matchEnd':
        onMatchEnd(ctx);
        break;
    }
  }
}

// ---------------------------------------------------------------- deal

function onDeal(ctx: DirectorCtx) {
  playSound('deal');
  if (!fxFull()) return;
  const deck = tablePoint();
  const w = 30 * fx.unit;
  for (const seat of [1, 2, 3] as const) {
    const to = seatPoint(((ctx.me + seat) % 4) as Seat);
    if (!to) continue;
    for (let i = 0; i < 7; i++) {
      fly(cardBackEl(w), deck, to, { duration: 360, delay: i * 95 + seat * 30, arc: 18, spin: (seat - 2) * 30, endScale: 0.55, fade: true });
    }
  }
  // Announce the level rank once the cards have landed.
  after(1250, () => {
    const c = tablePoint();
    brushText('打', {
      x: c.x,
      y: c.y - 6 * fx.unit,
      size: 58 * fx.unit,
      color: PALETTE.goldLight,
      latin: rankLabel(ctx.level),
      caption: ctx.t('fx_level'),
      hold: 950,
    });
    playSound('brush');
    fx.brush(c.x - 96 * fx.unit, c.y + 36 * fx.unit, c.x + 96 * fx.unit, c.y + 30 * fx.unit, {
      color: PALETTE.gold,
      width: 14,
      bow: -8,
      hold: 0.9,
      alpha: 0.75,
    });
  });
}

// ---------------------------------------------------------------- plays

function onPlay(seat: Seat, combo: Combo, ctx: DirectorCtx) {
  const plan = planPlay(combo);
  const timing = playTiming(plan.tier);
  const mine = seat === ctx.me;
  const landing = timing.impact + (combo.size - 1) * timing.stagger * 0.5;

  if (plan.tier <= 1) {
    playSound('play');
    if (mine) buzz(10);
    after(landing, () => {
      const p = trickPoint(seat);
      if (p) fx.dust(p.x, p.y + 16 * fx.unit, 3 + Math.min(4, combo.size), 30 + combo.size * 8);
    });
    if (plan.tier === 1) after(landing + 40, () => minorCallout(seat, combo, plan));
    return;
  }

  // Bombs: a whoosh as the cards rise, then everything lands on the same frame.
  playSound('whoosh');
  if (plan.tier === 5) {
    jokerBomb(seat, plan, landing);
    return;
  }
  after(landing, () => {
    const p = trickPoint(seat) ?? tablePoint();
    const u = fx.unit;
    if (plan.type === 'straightFlush') {
      straightFlush(seat, p, plan);
      return;
    }
    fx.ink(p.x, p.y, plan.ink * u);
    for (let i = 0; i < plan.rings; i++) fx.ring(p.x, p.y, { radius: (120 + i * 60) * u, width: 6 - i, delay: i * 0.09 });
    fx.burst(p.x, p.y, { count: plan.sparks, speed: [160, 420 + plan.tier * 60], gravity: 620, life: [0.35, 0.9] });
    fx.dust(p.x, p.y + 18 * u, 8, 120);
    if (plan.embers) fx.embers(p.x, p.y, plan.embers, 150 * u);
    flash(plan.tier >= 4 ? '#fff6dc' : PALETTE.goldLight, plan.flash);
    shake(plan.shake);
    playSound(plan.tier >= 4 ? 'boomBig' : plan.tier === 3 ? 'boom' : 'slam');
    buzz(plan.tier >= 4 ? [30, 30, 90] : plan.tier === 3 ? [25, 30, 50] : [22, 30, 30]);

    const at = calloutPoint(seat, 34 + plan.tier * 6);
    after(70, () => {
      // No caption: the label under the cards already names the bomb.
      seal('炸', { ...at, size: (26 + plan.tier * 10) * u, rotate: seat % 2 ? 5 : -7, hold: 700 + plan.tier * 100 });
      playSound('stamp', { delay: 0.12 });
    });
  });
}

function minorCallout(seat: Seat, combo: Combo, plan: PlayPlan) {
  const p = trickPoint(seat);
  if (!p || !plan.glyphs) return;
  const u = fx.unit;
  const at = calloutPoint(seat, 38);
  brushText(plan.glyphs, { ...at, size: 30 * u, color: PALETTE.porcelain, hold: 620 });
  playSound(combo.type === 'plate' ? 'clang' : 'brush');
  if (plan.sparks) fx.burst(p.x, p.y, { count: plan.sparks, speed: [80, 220], colors: [PALETTE.porcelain, PALETTE.celadon, PALETTE.goldPale], life: [0.2, 0.45] });
  if (plan.ripple) {
    // A light ink underline swept beneath the run.
    const w = (24 + combo.size * 9) * u;
    fx.brush(p.x - w, p.y + 30 * u, p.x + w, p.y + 27 * u, { color: PALETTE.porcelain, width: 7, alpha: 0.5, hold: 0.45, bow: -4 });
  }
}

function straightFlush(seat: Seat, p: Point, plan: PlayPlan) {
  const u = fx.unit;
  // A gold stroke swept under the run, sparks scattered along it.
  fx.brush(p.x - 150 * u, p.y + 36 * u, p.x + 150 * u, p.y + 26 * u, { color: PALETTE.gold, width: 30, bow: -16, hold: 1.1 });
  fx.brush(p.x - 120 * u, p.y + 44 * u, p.x + 132 * u, p.y + 38 * u, { color: PALETTE.goldLight, width: 9, bow: -10, hold: 1, delay: 0.08, alpha: 0.7 });
  for (let i = 0; i < 6; i++) {
    const x = p.x + (i / 5 - 0.5) * 260 * u;
    after(i * 45, () =>
      fx.burst(x, p.y + 30 * u, { count: Math.round(plan.sparks / 6), angle: -Math.PI / 2, spread: 2.2, speed: [120, 340], gravity: 380, colors: [PALETTE.goldPale, PALETTE.goldLight, PALETTE.gold], life: [0.4, 1] }),
    );
  }
  fx.ring(p.x, p.y, { radius: 150 * u, color: PALETTE.goldLight });
  flash(PALETTE.goldLight, plan.flash);
  shake(plan.shake);
  playSound('slam');
  playSound('sparkle', { delay: 0.06 });
  buzz([20, 40, 20, 40, 40]);
  const at = calloutPoint(seat, 44);
  after(120, () =>
    seal('同花顺', { ...at, size: 40 * u, tone: 'gold', rotate: -4, hold: 1100 }),
  );
}

function jokerBomb(seat: Seat, plan: PlayPlan, landing: number) {
  const u = fx.unit;
  dim(1, 1700);
  after(landing - 120, () => {
    const p = trickPoint(seat) ?? tablePoint();
    fx.lightning(p.x, p.y);
    fx.lightning(p.x + 30 * u, p.y, { delay: 0.2, fromX: p.x - 160 * u });
    playSound('thunder');
  });
  after(landing, () => {
    const p = trickPoint(seat) ?? tablePoint();
    flash('#fffbe8', plan.flash, 320);
    fx.ink(p.x, p.y, plan.ink * u, { life: 1.6 });
    for (let i = 0; i < plan.rings; i++) fx.ring(p.x, p.y, { radius: (150 + i * 90) * u, width: 7 - i, delay: i * 0.1, layer: 'front' });
    fx.burst(p.x, p.y, { count: plan.sparks, speed: [200, 760], gravity: 560, life: [0.5, 1.3], size: [1.4, 3.2] });
    fx.embers(p.x, p.y, plan.embers, 240 * u);
    fx.confettiBurst(p.x, p.y, 36, [PALETTE.gold, PALETTE.goldLight, PALETTE.goldPale]);
    shake(1);
    playSound('boomBig');
    buzz([40, 30, 40, 30, 140]);
  });
  // 天 · 王 · 炸 — three seals, one after another, each with its own thud.
  const c = tablePoint();
  const size = 58 * u;
  const gap = size * 1.52;
  ['天', '王', '炸'].forEach((glyph, i) => {
    after(landing + 180 + i * 170, () => {
      seal(glyph, {
        x: c.x + (i - 1) * gap,
        y: c.y - 4 * u,
        size,
        tone: i === 2 ? 'cinnabar' : 'gold',
        rotate: [-7, 3, -4][i],
        hold: 1500 - i * 170,
      });
      playSound('stamp');
      shake(0.4);
      fx.ring(c.x + (i - 1) * gap, c.y, { radius: 90 * u, layer: 'front', width: 4 });
    });
  });
}

// ---------------------------------------------------------------- flow

function onFinish(seat: Seat, place: number, ctx: DirectorCtx) {
  const first = place === 1;
  after(520, () => {
    const p = seatPoint(seat);
    if (!p) return;
    const u = fx.unit;
    playSound('stamp');
    playSound(first ? 'finishFirst' : 'finish', { delay: 0.08, step: 4 - place });
    if (first) {
      fx.ring(p.x, p.y, { radius: 90 * u, color: PALETTE.goldLight, layer: 'front' });
      fx.burst(p.x, p.y, { count: 34, angle: -Math.PI / 2, spread: 3.6, speed: [140, 420], gravity: 520, colors: [PALETTE.goldPale, PALETTE.goldLight, PALETTE.gold] });
      fx.confettiBurst(p.x, p.y, 16);
      if (seat === ctx.me) buzz([20, 40, 20, 40, 60]);
    } else {
      fx.ring(p.x, p.y, { radius: 54 * u, color: PALETTE.cinnabarLight, layer: 'front', width: 3 });
    }
    const at = calloutPoint(seat, first ? 48 : 40);
    brushText(PLACE_GLYPHS[place - 1]!, {
      ...at,
      size: (first ? 44 : 30) * u,
      color: first ? PALETTE.goldLight : PALETTE.porcelain,
      caption: ctx.lang === 'en' ? `${ctx.nameOf(seat)} · ${ctx.t(PLACE_KEYS[place - 1]!)}` : ctx.nameOf(seat),
      hold: first ? 900 : 600,
    });
  });
}

function onJiefeng(seat: Seat, ctx: DirectorCtx) {
  const from = seatPoint(partnerOf(seat));
  const to = seatPoint(seat);
  after(260, () => releaseGhosts(to));
  if (!from || !to) return;
  after(320, () => {
    // Wind: pale strokes swept from the finished player to the partner.
    for (let i = 0; i < 4; i++) {
      const off = (i - 1.5) * 16 * fx.unit;
      fx.brush(from.x + off, from.y + off * 0.4, to.x + off * 0.3, to.y + off * 0.2, {
        color: i % 2 ? PALETTE.celadon : PALETTE.porcelain,
        width: 10 - i,
        bow: (i % 2 ? 1 : -1) * (34 + i * 12) * fx.unit,
        draw: 0.42,
        hold: 0.25,
        alpha: 0.6,
        delay: i * 0.06,
        layer: 'front',
      });
    }
    playSound('whoosh');
    const at = calloutPoint(seat, 52);
    brushText('接风', {
      ...at,
      size: 40 * fx.unit,
      color: PALETTE.celadon,
      caption: ctx.lang === 'en' ? ctx.t('fx_jiefeng', { name: ctx.nameOf(seat) }) : ctx.nameOf(seat),
      hold: 900,
      delay: 260,
    });
  });
}

function onTribute(from: Seat, to: Seat, card: Card, ctx: DirectorCtx) {
  const a = seatPoint(from);
  const b = seatPoint(to);
  if (!a || !b) return;
  const u = fx.unit;
  playSound('whoosh');
  playSound('tribute', { delay: 0.5 });
  fx.burst(a.x, a.y, { count: 10, speed: [60, 180], life: [0.3, 0.6] });
  fly(makeCardEl(card, ctx.level, 46 * u), a, b, {
    duration: 760,
    arc: 60 * u,
    spin: 8,
    startScale: 0.7,
    endScale: 0.8,
    onDone: () => {
      fx.ring(b.x, b.y, { radius: 60 * u, color: PALETTE.goldLight, layer: 'front', width: 3 });
      fx.burst(b.x, b.y, { count: 14, speed: [80, 220], life: [0.3, 0.6] });
    },
  });
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 40 * u };
  brushText('进贡', { ...mid, size: 34 * u, color: PALETTE.goldLight, caption: ctx.lang === 'en' ? ctx.t('tributeTitle') : undefined, hold: 700, delay: 120 });
}

function onReturn(from: Seat, to: Seat) {
  const a = seatPoint(from);
  const b = seatPoint(to);
  if (!a || !b) return;
  playSound('whoosh');
  fly(cardBackEl(40 * fx.unit), a, b, { duration: 620, arc: 46 * fx.unit, spin: -10, startScale: 0.8, endScale: 0.7, fade: false });
}

function onHandEnd(ctx: DirectorCtx) {
  after(300, () => releaseGhosts(null));
  const r = ctx.result;
  if (!r) return;
  const won = r.winningTeam === teamOf(ctx.me);
  // 双下: the winners took first and second.
  if (r.partnerPlace === 2) {
    after(900, () => {
      const c = tablePoint();
      seal('双下', { x: c.x, y: c.y - 20 * fx.unit, size: 60 * fx.unit, tone: won ? 'gold' : 'cinnabar', caption: ctx.lang === 'en' ? ctx.t('fx_double') : undefined, hold: 900 });
      playSound('stamp');
      shake(0.3);
    });
  }
  after(r.partnerPlace === 2 ? 1900 : 1100, () => {
    playSound('gong');
    if (r.matchWinner !== null) return; // the match finale has its own show
    playSound(won ? 'win' : 'lose', { delay: 0.5 });
    if (won) fx.confettiRain(70);
  });
}

function onMatchEnd(ctx: DirectorCtx) {
  const r = ctx.result;
  const won = r ? r.matchWinner === teamOf(ctx.me) : false;
  after(1500, () => {
    playSound(won ? 'fanfare' : 'lose', { delay: 0.2 });
    if (!won) return;
    fx.confettiRain(110);
    // A volley of fireworks, then a few stragglers.
    for (let i = 0; i < 9; i++) {
      after(i * 420 + (i % 3) * 90, () => {
        fx.rocket(fx.width * (0.15 + Math.random() * 0.7), fx.height * (0.14 + Math.random() * 0.26));
        playSound('whoosh');
      });
    }
  });
}

/** Low-card alert when a seat drops to ten or five cards. */
export function cardsLeftAlert(seat: Seat, count: number, ctx: Pick<DirectorCtx, 't'>) {
  const p = seatPoint(seat);
  if (!p) return;
  const danger = count <= 5;
  floatText(ctx.t('fx_left', { n: count }), {
    x: p.x,
    y: p.y - 34 * fx.unit,
    size: danger ? 17 : 15,
    color: danger ? '#ff9d86' : PALETTE.goldLight,
    delay: 500,
  });
  if (danger) playSound('alarm', { delay: 0.5 });
}
