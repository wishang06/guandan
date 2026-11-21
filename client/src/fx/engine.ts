/**
 * A small canvas effects engine: two transparent layers (one behind the cards, one in
 * front of everything) and a handful of hand-drawn effect primitives in the game's
 * "ink, gold leaf and cinnabar" language.
 *
 * Items are plain objects with update()/draw(); the loop only runs while something is
 * alive, so an idle table costs nothing.
 */

import { fxFull } from './settings';

export type Layer = 'back' | 'front';

export interface FxItem {
  layer: Layer;
  /** Drawn with additive blending (light) instead of normal (pigment). */
  additive?: boolean;
  /** Advance by dt seconds. Return false when finished. */
  update(dt: number, engine: FxEngine): boolean;
  draw(ctx: CanvasRenderingContext2D): void;
}

export const PALETTE = {
  ink: '#0d0d10',
  gold: '#e0b04a',
  goldLight: '#f6d77a',
  goldPale: '#fff3c4',
  ember: '#ff8a3d',
  cinnabar: '#c23b22',
  cinnabarLight: '#e8573a',
  porcelain: '#f7f3e8',
  celadon: '#a8d4e2',
} as const;

const TAU = Math.PI * 2;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

type Range = number | [number, number];

export class FxEngine {
  private readonly canvases: Partial<Record<Layer, HTMLCanvasElement>> = {};
  private readonly contexts: Partial<Record<Layer, CanvasRenderingContext2D>> = {};
  private readonly items: Record<Layer, FxItem[]> = { back: [], front: [] };
  private raf = 0;
  private last = 0;
  private dpr = 1;
  width = 0;
  height = 0;
  /** Soft cap on live items in the front layer. */
  budget = 560;

  constructor(readonly random: () => number = Math.random) {}

  // ------------------------------------------------------------------ plumbing

  attach(layer: Layer, canvas: HTMLCanvasElement | null) {
    if (!canvas) {
      delete this.canvases[layer];
      delete this.contexts[layer];
      return;
    }
    this.canvases[layer] = canvas;
    const ctx = canvas.getContext('2d');
    if (ctx) this.contexts[layer] = ctx;
    this.resize();
  }

  resize() {
    if (typeof window === 'undefined') return;
    // Sparks and ink don't need retina sharpness; a smaller canvas is much cheaper to fill.
    this.dpr = Math.min(1.5, window.devicePixelRatio || 1);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    for (const canvas of Object.values(this.canvases)) {
      if (!canvas) continue;
      canvas.width = Math.round(this.width * this.dpr);
      canvas.height = Math.round(this.height * this.dpr);
    }
  }

  /** Scale factor so effects feel the same size on a phone and a desktop. */
  get unit(): number {
    const m = Math.min(this.width || 390, this.height || 700);
    return Math.max(0.8, Math.min(1.5, m / 420));
  }

  get count(): number {
    return this.items.back.length + this.items.front.length;
  }

  add(item: FxItem): void {
    if (!fxFull()) return; // reduced effects: no particles, ink or strokes at all
    const list = this.items[item.layer];
    if (item.layer === 'front' && list.length >= this.budget && item instanceof Spark) return;
    list.push(item);
    this.start();
  }

  clear() {
    this.items.back.length = 0;
    this.items.front.length = 0;
  }

  private start() {
    if (this.raf || typeof requestAnimationFrame !== 'function') return;
    this.last = 0;
    this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    this.step(dt);
    this.render();
    this.raf = this.count > 0 ? requestAnimationFrame(this.tick) : 0;
    if (!this.raf) this.render(); // final clear
  };

  /** Advance every item (exposed for tests and for stepping without a canvas). */
  step(dt: number) {
    for (const layer of ['back', 'front'] as const) {
      const list = this.items[layer];
      let w = 0;
      // Items added during update (bursts from rockets) land after `n` and are kept.
      const n = list.length;
      for (let i = 0; i < n; i++) {
        const item = list[i]!;
        if (item.update(dt, this)) list[w++] = item;
      }
      for (let i = n; i < list.length; i++) list[w++] = list[i]!;
      list.length = w;
    }
  }

  private render() {
    for (const layer of ['back', 'front'] as const) {
      const ctx = this.contexts[layer];
      if (!ctx) continue;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.width, this.height);
      const list = this.items[layer];
      ctx.globalCompositeOperation = 'source-over';
      for (const item of list) if (!item.additive) item.draw(ctx);
      ctx.globalCompositeOperation = 'lighter';
      for (const item of list) if (item.additive) item.draw(ctx);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
  }

  // ------------------------------------------------------------------ helpers

  rand(range: Range): number {
    return typeof range === 'number' ? range : range[0] + (range[1] - range[0]) * this.random();
  }

  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.random() * list.length)]!;
  }

  // ------------------------------------------------------------------ emitters

  /** A burst of streaking sparks. Angles in radians; spread is the full cone width. */
  burst(
    x: number,
    y: number,
    o: {
      count: number;
      speed?: Range;
      angle?: number;
      spread?: number;
      gravity?: number;
      drag?: number;
      life?: Range;
      size?: Range;
      colors?: readonly string[];
      layer?: Layer;
    },
  ) {
    const u = this.unit;
    const colors = o.colors ?? [PALETTE.gold, PALETTE.goldLight, PALETTE.ember];
    for (let i = 0; i < o.count; i++) {
      const a = (o.angle ?? 0) + (this.random() - 0.5) * (o.spread ?? TAU);
      const s = this.rand(o.speed ?? [120, 420]) * u;
      this.add(
        new Spark(
          x,
          y,
          Math.cos(a) * s,
          Math.sin(a) * s,
          this.rand(o.life ?? [0.35, 0.8]),
          this.rand(o.size ?? [1.2, 2.6]) * u,
          this.pick(colors),
          (o.gravity ?? 520) * u,
          o.drag ?? 0.94,
          o.layer ?? 'front',
        ),
      );
    }
  }

  ring(x: number, y: number, o: { radius: number; color?: string; width?: number; duration?: number; layer?: Layer; delay?: number }) {
    this.add(new Ring(x, y, o.radius, o.color ?? PALETTE.goldPale, o.width ?? 5, o.duration ?? 0.5, o.layer ?? 'back', o.delay ?? 0));
  }

  /** An ink blot that splashes out, holds, and soaks away. */
  ink(x: number, y: number, radius: number, o: { color?: string; layer?: Layer; life?: number } = {}) {
    this.add(new InkBlot(this, x, y, radius, o.color ?? PALETTE.ink, o.layer ?? 'back', o.life ?? 1.25));
  }

  /** A dry-brush stroke drawn from one point to another. */
  brush(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    o: { color?: string; width?: number; bow?: number; draw?: number; hold?: number; layer?: Layer; alpha?: number; delay?: number } = {},
  ) {
    this.add(new BrushStroke(this, x0, y0, x1, y1, o));
  }

  lightning(x: number, y: number, o: { fromX?: number; delay?: number } = {}) {
    this.add(new Lightning(this, o.fromX ?? x + (this.random() - 0.5) * 220, -20, x, y, o.delay ?? 0));
  }

  dust(x: number, y: number, count = 5, spreadX = 40) {
    for (let i = 0; i < count; i++) {
      this.add(new Puff(x + (this.random() - 0.5) * spreadX, y + (this.random() - 0.5) * 10, this.rand([14, 30]) * this.unit, this.rand([0.3, 0.55])));
    }
  }

  /** Glowing flecks that drift upward (after-burn of a big bomb). */
  embers(x: number, y: number, count: number, spreadX = 120) {
    for (let i = 0; i < count; i++) {
      this.add(
        new Spark(
          x + (this.random() - 0.5) * spreadX,
          y + (this.random() - 0.5) * 30,
          (this.random() - 0.5) * 50,
          -this.rand([40, 150]),
          this.rand([0.8, 1.9]),
          this.rand([1.4, 2.8]) * this.unit,
          this.pick([PALETTE.ember, PALETTE.gold, PALETTE.goldLight]),
          -30,
          0.985,
          'front',
          true,
        ),
      );
    }
  }

  /** Paper and gold-leaf flakes fluttering down from the top of the screen. */
  confettiRain(count: number, colors: readonly string[] = [PALETTE.gold, PALETTE.goldLight, PALETTE.cinnabar, PALETTE.porcelain]) {
    for (let i = 0; i < count; i++) {
      this.add(
        new Flake(
          this,
          this.random() * this.width,
          -20 - this.random() * this.height * 0.5,
          (this.random() - 0.5) * 60,
          this.rand([90, 240]),
          this.pick(colors),
          this.rand([2.6, 4.6]),
        ),
      );
    }
  }

  confettiBurst(x: number, y: number, count: number, colors: readonly string[] = [PALETTE.gold, PALETTE.goldLight, PALETTE.cinnabar, PALETTE.porcelain]) {
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + (this.random() - 0.5) * 2.4;
      const s = this.rand([220, 620]) * this.unit;
      this.add(new Flake(this, x, y, Math.cos(a) * s, Math.sin(a) * s, this.pick(colors), this.rand([1.6, 2.8])));
    }
  }

  /** A firework rocket that climbs and bursts. */
  rocket(x: number, apexY: number, colors?: readonly string[]) {
    this.add(new Rocket(this, x, this.height + 10, apexY, colors ?? this.pick(FIREWORK_SETS)));
  }
}

const FIREWORK_SETS: readonly (readonly string[])[] = [
  [PALETTE.gold, PALETTE.goldLight, PALETTE.goldPale],
  [PALETTE.cinnabarLight, PALETTE.ember, PALETTE.goldLight],
  [PALETTE.celadon, PALETTE.porcelain, PALETTE.goldPale],
];

// ====================================================================== items

export class Spark implements FxItem {
  additive = true;
  private readonly max: number;
  constructor(
    private x: number,
    private y: number,
    private vx: number,
    private vy: number,
    private life: number,
    private readonly size: number,
    private readonly color: string,
    private readonly gravity: number,
    private readonly drag: number,
    readonly layer: Layer,
    private readonly flicker = false,
  ) {
    this.max = life;
  }

  update(dt: number): boolean {
    const k = Math.pow(this.drag, dt * 60);
    this.vx *= k;
    this.vy = this.vy * k + this.gravity * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
    return this.life > 0;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    let a = clamp01((this.life / this.max) * 1.8);
    if (this.flicker) a *= 0.55 + 0.45 * Math.sin(this.life * 37 + this.x);
    ctx.globalAlpha = a;
    ctx.strokeStyle = this.color;
    ctx.lineWidth = this.size;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(this.x - this.vx * 0.035, this.y - this.vy * 0.035);
    ctx.lineTo(this.x, this.y);
    ctx.stroke();
  }
}

export class Ring implements FxItem {
  additive = true;
  private t = 0;
  constructor(
    private readonly x: number,
    private readonly y: number,
    private readonly radius: number,
    private readonly color: string,
    private readonly width: number,
    private readonly duration: number,
    readonly layer: Layer,
    private delay: number,
  ) {}

  update(dt: number): boolean {
    if (this.delay > 0) {
      this.delay -= dt;
      return true;
    }
    this.t += dt / this.duration;
    return this.t < 1;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.delay > 0) return;
    const p = easeOutCubic(this.t);
    ctx.globalAlpha = Math.pow(1 - this.t, 1.4) * 0.9;
    ctx.strokeStyle = this.color;
    ctx.lineWidth = Math.max(0.5, this.width * (1 - this.t));
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius * p, 0, TAU);
    ctx.stroke();
  }
}

/** Soft dust puff kicked up where cards land. */
export class Puff implements FxItem {
  readonly layer: Layer = 'back';
  private t = 0;
  constructor(
    private readonly x: number,
    private readonly y: number,
    private readonly radius: number,
    private readonly duration: number,
  ) {}

  update(dt: number): boolean {
    this.t += dt / this.duration;
    return this.t < 1;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.globalAlpha = 0.16 * (1 - this.t);
    ctx.fillStyle = PALETTE.porcelain;
    ctx.beginPath();
    ctx.arc(this.x, this.y - this.t * 8, this.radius * (0.35 + 0.65 * easeOutCubic(this.t)), 0, TAU);
    ctx.fill();
  }
}

export class InkBlot implements FxItem {
  private t = 0;
  private readonly radii: number[] = [];
  private readonly drops: { a: number; d: number; r: number; delay: number }[] = [];
  private readonly rot: number;

  constructor(
    engine: FxEngine,
    private readonly x: number,
    private readonly y: number,
    private readonly radius: number,
    private readonly color: string,
    readonly layer: Layer,
    private readonly life: number,
  ) {
    const n = 26;
    for (let i = 0; i < n; i++) {
      // Mostly round, with a few arms flung outwards like a real splash.
      const arm = engine.random() < 0.22 ? 0.25 + engine.random() * 0.4 : 0;
      this.radii.push(0.7 + engine.random() * 0.26 + arm);
    }
    const drops = 6 + Math.floor(engine.random() * 5);
    for (let i = 0; i < drops; i++) {
      this.drops.push({
        a: engine.random() * TAU,
        d: 1.15 + engine.random() * 0.75,
        r: 0.04 + engine.random() * 0.09,
        delay: 0.04 + engine.random() * 0.1,
      });
    }
    this.rot = engine.random() * TAU;
  }

  update(dt: number): boolean {
    this.t += dt;
    return this.t < this.life;
  }

  private path(ctx: CanvasRenderingContext2D, scale: number) {
    const n = this.radii.length;
    const pt = (i: number): [number, number] => {
      const a = this.rot + (i / n) * TAU;
      const r = this.radii[(i + n) % n]! * this.radius * scale;
      return [this.x + Math.cos(a) * r, this.y + Math.sin(a) * r * 0.82];
    };
    ctx.beginPath();
    let [px, py] = pt(0);
    let [qx, qy] = pt(1);
    ctx.moveTo((px + qx) / 2, (py + qy) / 2);
    for (let i = 1; i <= n; i++) {
      [px, py] = pt(i);
      [qx, qy] = pt(i + 1);
      ctx.quadraticCurveTo(px, py, (px + qx) / 2, (py + qy) / 2);
    }
    ctx.closePath();
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const grow = easeOutExpo(clamp01(this.t / 0.3));
    const fade = 1 - clamp01((this.t - this.life * 0.45) / (this.life * 0.55));
    ctx.fillStyle = this.color;
    // A lighter wash around the blot, then the dense core.
    ctx.globalAlpha = 0.22 * fade;
    this.path(ctx, grow * 1.16);
    ctx.fill();
    ctx.globalAlpha = 0.78 * fade;
    this.path(ctx, grow);
    ctx.fill();
    for (const d of this.drops) {
      const p = easeOutExpo(clamp01((this.t - d.delay) / 0.32));
      if (p <= 0) continue;
      ctx.beginPath();
      ctx.arc(
        this.x + Math.cos(d.a) * d.d * this.radius * p,
        this.y + Math.sin(d.a) * d.d * this.radius * p * 0.82,
        d.r * this.radius,
        0,
        TAU,
      );
      ctx.fill();
    }
  }
}

interface Bristle {
  offset: number;
  start: number;
  end: number;
  alpha: number;
  width: number;
}

/** A dry-brush stroke: many bristles with ragged ends, revealed along the path. */
export class BrushStroke implements FxItem {
  readonly layer: Layer;
  private t = 0;
  private delay: number;
  private readonly bristles: Bristle[] = [];
  private readonly color: string;
  private readonly drawTime: number;
  private readonly hold: number;
  private readonly alpha: number;
  private readonly cx: number;
  private readonly cy: number;

  constructor(
    engine: FxEngine,
    private readonly x0: number,
    private readonly y0: number,
    private readonly x1: number,
    private readonly y1: number,
    o: { color?: string; width?: number; bow?: number; draw?: number; hold?: number; layer?: Layer; alpha?: number; delay?: number },
  ) {
    this.layer = o.layer ?? 'back';
    this.color = o.color ?? PALETTE.gold;
    this.drawTime = o.draw ?? 0.3;
    this.hold = o.hold ?? 0.7;
    this.alpha = o.alpha ?? 0.9;
    this.delay = o.delay ?? 0;
    const width = o.width ?? 26;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const bow = o.bow ?? 0;
    // Control point pushed sideways to bow the stroke.
    this.cx = (x0 + x1) / 2 + (-dy / len) * bow;
    this.cy = (y0 + y1) / 2 + (dx / len) * bow;
    const n = Math.max(6, Math.round(width / 2.2));
    for (let i = 0; i < n; i++) {
      const edge = Math.abs(i / (n - 1) - 0.5) * 2; // 0 centre … 1 edge
      this.bristles.push({
        offset: (i / (n - 1) - 0.5) * width,
        start: engine.random() * 0.06 * (1 + edge),
        end: 1 - engine.random() * 0.2 * (0.4 + edge),
        alpha: 0.35 + engine.random() * 0.65 * (1 - edge * 0.5),
        width: 1 + engine.random() * 2.2,
      });
    }
  }

  update(dt: number): boolean {
    if (this.delay > 0) {
      this.delay -= dt;
      return true;
    }
    this.t += dt;
    return this.t < this.drawTime + this.hold + 0.45;
  }

  private point(t: number, offset: number): [number, number] {
    const mt = 1 - t;
    const x = mt * mt * this.x0 + 2 * mt * t * this.cx + t * t * this.x1;
    const y = mt * mt * this.y0 + 2 * mt * t * this.cy + t * t * this.y1;
    // Tangent → normal for the bristle offset; taper the ends like a lifted brush.
    const tx = 2 * mt * (this.cx - this.x0) + 2 * t * (this.x1 - this.cx);
    const ty = 2 * mt * (this.cy - this.y0) + 2 * t * (this.y1 - this.cy);
    const tl = Math.hypot(tx, ty) || 1;
    const taper = Math.min(1, t * 9) * (0.55 + 0.45 * Math.min(1, (1 - t) * 4));
    return [x + (-ty / tl) * offset * taper, y + (tx / tl) * offset * taper];
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.delay > 0) return;
    const reveal = easeOutCubic(clamp01(this.t / this.drawTime));
    const fade = 1 - clamp01((this.t - this.drawTime - this.hold) / 0.45);
    ctx.strokeStyle = this.color;
    ctx.lineCap = 'round';
    for (const b of this.bristles) {
      const end = Math.min(b.end, reveal);
      if (end <= b.start) continue;
      ctx.globalAlpha = b.alpha * this.alpha * fade;
      ctx.lineWidth = b.width;
      ctx.beginPath();
      const steps = 12;
      for (let i = 0; i <= steps; i++) {
        const [x, y] = this.point(b.start + ((end - b.start) * i) / steps, b.offset);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
}

/** A forked bolt from the top of the screen. Strikes once and re-strikes once. */
export class Lightning implements FxItem {
  readonly layer: Layer = 'front';
  additive = true;
  private t = 0;
  private readonly paths: [number, number][][] = [];

  constructor(
    engine: FxEngine,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    private delay: number,
  ) {
    const main = Lightning.bolt(engine, x0, y0, x1, y1, 5, 70);
    this.paths.push(main);
    for (let b = 0; b < 2; b++) {
      const from = main[6 + Math.floor(engine.random() * (main.length - 12))]!;
      const len = 60 + engine.random() * 120;
      const dir = engine.random() < 0.5 ? -1 : 1;
      this.paths.push(Lightning.bolt(engine, from[0], from[1], from[0] + dir * len, from[1] + len * 0.9, 4, 28));
    }
  }

  private static bolt(engine: FxEngine, x0: number, y0: number, x1: number, y1: number, depth: number, jitter: number) {
    let pts: [number, number][] = [
      [x0, y0],
      [x1, y1],
    ];
    for (let d = 0; d < depth; d++) {
      const next: [number, number][] = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i]!;
        const [bx, by] = pts[i + 1]!;
        next.push([ax, ay], [(ax + bx) / 2 + (engine.random() - 0.5) * jitter, (ay + by) / 2 + (engine.random() - 0.5) * jitter * 0.3]);
      }
      next.push(pts[pts.length - 1]!);
      pts = next;
      jitter *= 0.55;
    }
    return pts;
  }

  update(dt: number): boolean {
    if (this.delay > 0) {
      this.delay -= dt;
      return true;
    }
    this.t += dt;
    return this.t < 0.46;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.delay > 0) return;
    // Bright strike, a dark gap, one re-strike that fades.
    const t = this.t;
    const a = t < 0.09 ? 1 : t < 0.15 ? 0.08 : 1 - clamp01((t - 0.15) / 0.31);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [width, alpha, color] of [
      [16, 0.1, PALETTE.gold],
      [7, 0.3, PALETTE.goldLight],
      [2.2, 1, '#fffbe8'],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha * a;
      this.paths.forEach((pts, i) => {
        ctx.lineWidth = width * (i === 0 ? 1 : 0.5);
        ctx.beginPath();
        pts.forEach(([x, y], k) => (k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        ctx.stroke();
      });
    }
  }
}

/** A flake of paper or gold leaf: tumbles, flutters sideways, fades at the end. */
export class Flake implements FxItem {
  readonly layer: Layer = 'front';
  private rot: number;
  private spin: number;
  private readonly vr: number;
  private readonly vs: number;
  private readonly w: number;
  private readonly h: number;
  private readonly phase: number;
  private readonly max: number;

  constructor(
    engine: FxEngine,
    private x: number,
    private y: number,
    private vx: number,
    private vy: number,
    private readonly color: string,
    private life: number,
  ) {
    this.max = life;
    this.rot = engine.random() * TAU;
    this.spin = engine.random() * TAU;
    this.vr = (engine.random() - 0.5) * 6;
    this.vs = 4 + engine.random() * 8;
    this.w = (5 + engine.random() * 6) * engine.unit;
    this.h = (7 + engine.random() * 8) * engine.unit;
    this.phase = engine.random() * TAU;
  }

  update(dt: number, engine: FxEngine): boolean {
    const k = Math.pow(0.975, dt * 60);
    this.vx *= k;
    this.vy = Math.min(260, this.vy * k + 300 * dt);
    this.x += (this.vx + Math.sin(this.phase + this.life * 3.1) * 46) * dt;
    this.y += this.vy * dt;
    this.rot += this.vr * dt;
    this.spin += this.vs * dt;
    this.life -= dt;
    return this.life > 0 && this.y < engine.height + 30;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.globalAlpha = clamp01((this.life / this.max) * 4);
    ctx.fillStyle = this.color;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rot);
    ctx.scale(1, Math.cos(this.spin));
    ctx.fillRect(-this.w / 2, -this.h / 2, this.w, this.h);
    ctx.restore();
  }
}

/** Firework rocket: climbs with a spark trail, then bursts into a sphere of sparks. */
export class Rocket implements FxItem {
  readonly layer: Layer = 'front';
  additive = true;
  private vy: number;
  private trail = 0;

  constructor(
    engine: FxEngine,
    private x: number,
    private y: number,
    private readonly apexY: number,
    private readonly colors: readonly string[],
  ) {
    // Launch speed that just reaches the apex under the gravity used in update().
    this.vy = -Math.sqrt(2 * 520 * Math.max(40, y - apexY));
    this.x += (engine.random() - 0.5) * 20;
  }

  update(dt: number, engine: FxEngine): boolean {
    this.vy += 520 * dt;
    this.y += this.vy * dt;
    this.trail += dt;
    if (this.trail > 0.02) {
      this.trail = 0;
      engine.add(new Spark(this.x, this.y, (engine.random() - 0.5) * 30, 60, 0.3, 1.4, PALETTE.goldLight, 200, 0.95, 'front'));
    }
    if (this.vy >= -30 || this.y <= this.apexY) {
      const u = engine.unit;
      engine.ring(this.x, this.y, { radius: 90 * u, color: this.colors[0], width: 3, duration: 0.6, layer: 'front' });
      engine.burst(this.x, this.y, {
        count: 64,
        speed: [90, 330],
        gravity: 150,
        drag: 0.955,
        life: [0.9, 1.6],
        size: [1.4, 2.6],
        colors: this.colors,
      });
      return false;
    }
    return true;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.globalAlpha = 1;
    ctx.fillStyle = PALETTE.goldPale;
    ctx.beginPath();
    ctx.arc(this.x, this.y, 2.2, 0, TAU);
    ctx.fill();
  }
}

/** The single engine used by the app. */
export const fx = new FxEngine();
