import { fxFull } from './settings';

/**
 * Imperative DOM effects: stamped seals, brushed callouts, flashes, floating text and
 * "ghost" cards that fly between seats. Everything lives in one pointer-transparent
 * overlay and removes itself when its animation ends.
 */

let root: HTMLElement | null = null;

export function setFxRoot(el: HTMLElement | null) {
  root = el;
}

export interface Point {
  x: number;
  y: number;
}

export const centerOf = (r: DOMRect): Point => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

function el(className: string, parent?: HTMLElement): HTMLDivElement {
  const d = document.createElement('div');
  d.className = className;
  parent?.appendChild(d);
  return d;
}

function finish(anim: Animation, node: HTMLElement) {
  const remove = () => node.remove();
  anim.finished.then(remove, remove);
}

const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

// ---------------------------------------------------------------- seals & text

export interface SealOptions extends Point {
  /** Glyph height in px. */
  size: number;
  tone?: 'cinnabar' | 'gold' | 'ink';
  caption?: string;
  rotate?: number;
  /** How long it stays after landing, ms. */
  hold?: number;
  delay?: number;
}

/** A seal slammed onto the table: oversized and tilted, hits, rebounds, lingers, lifts. */
export function seal(text: string, o: SealOptions): void {
  if (!root) return;
  const wrap = el(`fx-seal ${o.tone ?? 'cinnabar'}`);
  wrap.style.left = `${o.x}px`;
  wrap.style.top = `${o.y}px`;
  wrap.style.setProperty('--size', `${o.size}px`);
  // The block moves; its face carries the (expensive) rough-edge filter and is
  // rasterised once, so the slam animates on the compositor.
  const block = el('fx-seal-block', wrap);
  el('fx-seal-face', block).textContent = text;
  let caption: HTMLElement | null = null;
  if (o.caption) {
    caption = el('fx-caption', wrap);
    caption.textContent = o.caption;
  }
  root.appendChild(wrap);

  const hold = o.hold ?? 900;
  const delay = o.delay ?? 0;
  const r = o.rotate ?? -6;
  if (!fxFull()) {
    finish(
      wrap.animate([{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], {
        duration: hold + 500,
        delay,
        fill: 'both',
      }),
      wrap,
    );
    return;
  }
  const slam = 380;
  const out = 300;
  const total = slam + hold + out;
  const a = slam / total;
  const b = (slam + hold) / total;
  finish(
    block.animate(
      [
        // Falls fast (ease-in), hits slightly squashed, rebounds, settles.
        { transform: `scale(2.6) rotate(${r - 12}deg)`, opacity: 0, offset: 0, easing: 'cubic-bezier(0.6, 0, 0.9, 0.5)' },
        { transform: `scale(0.88) rotate(${r + 1}deg)`, opacity: 1, offset: a * 0.5, easing: EASE_OUT },
        { transform: `scale(1.07) rotate(${r}deg)`, opacity: 1, offset: a * 0.76, easing: 'ease-in-out' },
        { transform: `scale(1) rotate(${r}deg)`, opacity: 1, offset: a },
        { transform: `scale(1) rotate(${r}deg)`, opacity: 1, offset: b, easing: 'ease-in' },
        { transform: `scale(1.12) rotate(${r}deg) translateY(-8px)`, opacity: 0, offset: 1 },
      ],
      { duration: total, delay, fill: 'both', easing: 'linear' },
    ),
    wrap,
  );
  caption?.animate(
    [
      { opacity: 0, transform: 'translateY(8px)', offset: 0 },
      { opacity: 0, transform: 'translateY(8px)', offset: a },
      { opacity: 1, transform: 'translateY(0)', offset: a + (1 - a) * 0.12 },
      { opacity: 1, offset: b },
      { opacity: 0, offset: 1 },
    ],
    { duration: total, delay, fill: 'both' },
  );
}

export interface BrushTextOptions extends Point {
  size: number;
  color?: string;
  caption?: string;
  /** Latin text set in the display serif after the brush glyphs (e.g. a rank). */
  latin?: string;
  hold?: number;
  delay?: number;
}

/** Calligraphy written across the felt: revealed left to right, then drifts up and fades. */
export function brushText(text: string, o: BrushTextOptions): void {
  if (!root) return;
  const wrap = el('fx-brush');
  wrap.style.left = `${o.x}px`;
  wrap.style.top = `${o.y}px`;
  wrap.style.setProperty('--size', `${o.size}px`);
  if (o.color) wrap.style.setProperty('--tone', o.color);
  const line = el('fx-brush-text', wrap);
  line.textContent = text;
  if (o.latin) {
    const latin = document.createElement('span');
    latin.className = 'latin';
    latin.textContent = ` ${o.latin}`;
    line.appendChild(latin);
  }
  if (o.caption) el('fx-caption', wrap).textContent = o.caption;
  root.appendChild(wrap);

  const hold = o.hold ?? 800;
  const total = 300 + hold + 320;
  const a = 300 / total;
  const b = (300 + hold) / total;
  const frames: Keyframe[] = fxFull()
    ? [
        { clipPath: 'inset(-20% 100% -20% -10%)', transform: 'scale(1.18)', opacity: 0.4, offset: 0 },
        { clipPath: 'inset(-20% -10% -20% -10%)', transform: 'scale(1)', opacity: 1, offset: a, easing: EASE_OUT },
        { clipPath: 'inset(-20% -10% -20% -10%)', transform: 'scale(1)', opacity: 1, offset: b },
        { clipPath: 'inset(-20% -10% -20% -10%)', transform: 'translateY(-14px) scale(1.04)', opacity: 0, offset: 1 },
      ]
    : [{ opacity: 0 }, { opacity: 1, offset: a }, { opacity: 1, offset: b }, { opacity: 0 }];
  finish(wrap.animate(frames, { duration: total, delay: o.delay ?? 0, fill: 'both' }), wrap);
}

/** Small text that pops and floats up (card-count warnings, "+3"). */
export function floatText(text: string, o: Point & { color?: string; size?: number; delay?: number }): void {
  if (!root) return;
  const node = el('fx-float');
  node.textContent = text;
  node.style.left = `${o.x}px`;
  node.style.top = `${o.y}px`;
  node.style.color = o.color ?? '#f7f3e8';
  node.style.fontSize = `${o.size ?? 16}px`;
  root.appendChild(node);
  finish(
    node.animate(
      [
        { opacity: 0, transform: 'translateY(6px) scale(0.6)' },
        { opacity: 1, transform: 'translateY(0) scale(1.15)', offset: 0.18 },
        { opacity: 1, transform: 'translateY(-6px) scale(1)', offset: 0.7 },
        { opacity: 0, transform: 'translateY(-26px) scale(1)' },
      ],
      { duration: 1300, delay: o.delay ?? 0, fill: 'both' },
    ),
    node,
  );
}

// ---------------------------------------------------------------- light

/** One soft pulse of light over the whole screen (never strobes). */
export function flash(color: string, peak: number, duration = 260, delay = 0): void {
  if (!root || !fxFull() || peak <= 0) return;
  const node = el('fx-overlay');
  node.style.background = color;
  root.appendChild(node);
  finish(node.animate([{ opacity: peak }, { opacity: 0 }], { duration, delay, fill: 'both', easing: 'ease-out' }), node);
}

let dimLayer: HTMLElement | null = null;

/** The table registers a layer that sits on the felt, under the cards and seats. */
export function setDimLayer(node: HTMLElement | null) {
  dimLayer = node;
}

/**
 * Bring the lights down on the felt for a set-piece. Cards, seats and effects stay
 * lit — only the cloth darkens.
 */
export function dim(peak: number, hold: number, delay = 0): void {
  if (!dimLayer || !fxFull()) return;
  const total = 180 + hold + 420;
  dimLayer.animate(
    [
      { opacity: 0, offset: 0 },
      { opacity: peak, offset: 180 / total },
      { opacity: peak, offset: (180 + hold) / total },
      { opacity: 0, offset: 1 },
    ],
    { duration: total, delay },
  );
}

// ---------------------------------------------------------------- flying cards

export function cardBackEl(width: number): HTMLDivElement {
  const node = el('card static card-back');
  node.style.setProperty('--cw', `${width}px`);
  return node;
}

export interface FlyOptions {
  duration?: number;
  delay?: number;
  /** How far the path bulges upwards, px. */
  arc?: number;
  /** Degrees of spin picked up along the way. */
  spin?: number;
  /** Scale at the destination relative to the element's own size. */
  endScale?: number;
  startScale?: number;
  /** Fade out over the last part of the flight. */
  fade?: boolean;
  onDone?: () => void;
}

/**
 * Fly a detached element from one point to another along an arc. The element is
 * centred on its path and removed at the end.
 */
export function fly(node: HTMLElement, from: Point, to: Point, o: FlyOptions = {}): void {
  if (!root || !fxFull()) {
    o.onDone?.();
    return;
  }
  const holder = el('fx-ghost');
  holder.style.left = '0';
  holder.style.top = '0';
  holder.appendChild(node);
  root.appendChild(holder);
  const w = node.offsetWidth;
  const h = node.offsetHeight;
  const at = (p: Point, lift: number, scale: number, rot: number) =>
    `translate3d(${p.x - w / 2}px, ${p.y - h / 2 - lift}px, 0) scale(${scale}) rotate(${rot}deg)`;
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const arc = o.arc ?? 40;
  const spin = o.spin ?? 0;
  const s0 = o.startScale ?? 1;
  const s1 = o.endScale ?? 1;
  const anim = holder.animate(
    [
      { transform: at(from, 0, s0, 0), opacity: 1, offset: 0 },
      { transform: at(mid, arc, (s0 + s1) / 2 + 0.08, spin / 2), opacity: 1, offset: 0.5 },
      { transform: at(to, 0, s1, spin), opacity: o.fade ? 0 : 1, offset: 1 },
    ],
    { duration: o.duration ?? 520, delay: o.delay ?? 0, fill: 'both', easing: 'cubic-bezier(0.4, 0, 0.3, 1)' },
  );
  const done = () => {
    holder.remove();
    o.onDone?.();
  };
  anim.finished.then(done, done);
}

// ---------------------------------------------------------------- ghosts

interface Ghost {
  clone: HTMLElement;
  rect: DOMRect;
  source: HTMLElement;
}

const pending: Ghost[] = [];
let fallback = 0;

/**
 * Remember what an element looked like just before React removes it, so it can be
 * animated away (e.g. a finished trick sweeping to its winner). Call from a layout
 * effect cleanup, while the element is still in the document.
 */
export function captureGhost(source: HTMLElement): void {
  if (!root || !fxFull()) return;
  const rect = source.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  pending.push({ clone: source.cloneNode(true) as HTMLElement, rect, source });
  if (!fallback) fallback = window.setTimeout(() => releaseGhosts(null), 140);
}

/**
 * Animate every captured ghost away: towards `target` (gathered up by a player), or
 * fading in place when there is none. Elements that are still mounted are skipped.
 */
export function releaseGhosts(target: Point | null): void {
  if (fallback) {
    clearTimeout(fallback);
    fallback = 0;
  }
  const list = pending.splice(0);
  list.forEach((g, i) => {
    if (!root || g.source.isConnected) return;
    const node = g.clone;
    node.classList.add('fx-ghost');
    node.removeAttribute('data-testid');
    node.style.left = `${g.rect.left}px`;
    node.style.top = `${g.rect.top}px`;
    node.style.width = `${g.rect.width}px`;
    node.style.height = `${g.rect.height}px`;
    root.appendChild(node);
    const c = centerOf(g.rect);
    const frames: Keyframe[] = target
      ? [
          { transform: 'none', opacity: 1 },
          { transform: `translate(${(target.x - c.x) * 0.25}px, ${(target.y - c.y) * 0.25}px) scale(0.9) rotate(${i % 2 ? 4 : -4}deg)`, opacity: 1, offset: 0.35 },
          { transform: `translate(${target.x - c.x}px, ${target.y - c.y}px) scale(0.15) rotate(${i % 2 ? 18 : -18}deg)`, opacity: 0 },
        ]
      : [
          { transform: 'none', opacity: 1 },
          { transform: 'scale(0.9) translateY(6px)', opacity: 0 },
        ];
    finish(
      node.animate(frames, {
        duration: target ? 420 : 200,
        delay: target ? i * 45 : 0,
        fill: 'both',
        easing: 'cubic-bezier(0.5, 0, 0.8, 0.6)',
      }),
      node,
    );
  });
}
