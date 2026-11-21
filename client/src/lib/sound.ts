import { KEYS, load, save } from './storage';

/**
 * Synthesised sound effects — no audio files. Everything is built from oscillators and
 * filtered noise, voiced around a Chinese pentatonic scale (宫商角徵羽) so chimes and
 * fanfares sit together. The AudioContext is created on the first user gesture, as
 * mobile browsers require.
 */
export type SoundName =
  | 'select'
  | 'deselect'
  | 'deal'
  | 'flip'
  | 'play'
  | 'pass'
  | 'slam'
  | 'boom'
  | 'boomBig'
  | 'thunder'
  | 'sparkle'
  | 'clang'
  | 'stamp'
  | 'whoosh'
  | 'brush'
  | 'gong'
  | 'turn'
  | 'tick'
  | 'alarm'
  | 'finish'
  | 'finishFirst'
  | 'level'
  | 'tribute'
  | 'win'
  | 'lose'
  | 'fanfare';

let ctx: AudioContext | null = null;
let out: AudioNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let muted = load<boolean>(KEYS.muted, false);
const listeners = new Set<(m: boolean) => void>();

export function isMuted() {
  return muted;
}

export function setMuted(m: boolean) {
  muted = m;
  save(KEYS.muted, m);
  listeners.forEach((l) => l(m));
}

export function onMutedChange(fn: (m: boolean) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Call from a user gesture to unlock audio on iOS/Android. */
export function unlockAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      // A gentle limiter so stacked effects (bomb + shake + seal) never clip.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 18;
      comp.ratio.value = 6;
      comp.attack.value = 0.003;
      comp.release.value = 0.2;
      const master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(comp).connect(ctx.destination);
      out = master;
      const len = ctx.sampleRate * 2;
      noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}

// ---------------------------------------------------------------- building blocks

/** Pentatonic degrees from C4: index 0..14 → C D E G A across three octaves. */
const PENTA = [0, 2, 4, 7, 9];
function penta(step: number, base = 261.63): number {
  const octave = Math.floor(step / 5);
  const semis = PENTA[((step % 5) + 5) % 5]! + octave * 12;
  return base * Math.pow(2, semis / 12);
}

interface ToneOpts {
  type?: OscillatorType;
  gain?: number;
  attack?: number;
  /** Glide to this frequency over the note. */
  to?: number;
}

function tone(freq: number, start: number, dur: number, o: ToneOpts = {}) {
  if (!ctx || !out || freq > 14000) return; // inaudible partials are skipped
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, start);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), start + dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(o.gain ?? 0.08, start + (o.attack ?? 0.008));
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(out);
  osc.start(start);
  osc.stop(start + dur + 0.03);
}

interface NoiseOpts {
  gain?: number;
  filter?: BiquadFilterType;
  freq?: number;
  /** Sweep the filter to this frequency. */
  to?: number;
  q?: number;
  attack?: number;
}

function noise(start: number, dur: number, o: NoiseOpts = {}) {
  if (!ctx || !out || !noiseBuffer) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = o.filter ?? 'lowpass';
  f.frequency.setValueAtTime(o.freq ?? 2000, start);
  if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, start + dur);
  f.Q.value = o.q ?? 0.8;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(o.gain ?? 0.2, start + (o.attack ?? 0.004));
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(f).connect(g).connect(out);
  src.start(start, Math.random() * 1.5);
  src.stop(start + dur + 0.03);
}

/** Plucked string (guzheng-ish): bright attack, quick decay, a quiet octave above. */
function pluck(freq: number, start: number, gain = 0.09, decay = 0.5) {
  tone(freq, start, decay, { type: 'triangle', gain, attack: 0.004 });
  tone(freq * 2, start, decay * 0.5, { type: 'sine', gain: gain * 0.35, attack: 0.004 });
  noise(start, 0.02, { gain: gain * 0.5, filter: 'highpass', freq: 3000 });
}

/** Small bell: a few inharmonic sine partials. */
function bell(freq: number, start: number, gain = 0.06, decay = 0.7) {
  tone(freq, start, decay, { gain });
  tone(freq * 2.76, start, decay * 0.6, { gain: gain * 0.4 });
  tone(freq * 5.4, start, decay * 0.3, { gain: gain * 0.2 });
}

/** Low thump: a sine that drops in pitch. */
function thump(start: number, from: number, to: number, dur: number, gain: number) {
  tone(from, start, dur, { gain, to, attack: 0.003 });
}

// ---------------------------------------------------------------- the sounds

export interface SoundOptions {
  /** Start this many seconds from now. */
  delay?: number;
  /** A scale step for sounds that climb (level-ups, finishing places). */
  step?: number;
}

export function playSound(name: SoundName, o: SoundOptions = {}) {
  if (muted || !ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime + (o.delay ?? 0);
  switch (name) {
    case 'select':
      tone(1250, t, 0.035, { type: 'triangle', gain: 0.035, to: 1700 });
      break;
    case 'deselect':
      tone(1100, t, 0.035, { type: 'triangle', gain: 0.03, to: 760 });
      break;
    case 'deal':
      // A riffle: quick paper ticks that speed up slightly.
      for (let i = 0; i < 22; i++) noise(t + i * 0.034 - i * i * 0.0003, 0.03, { gain: 0.12, filter: 'bandpass', freq: 2600 + i * 60, q: 1.2 });
      break;
    case 'flip':
      noise(t, 0.05, { gain: 0.1, filter: 'bandpass', freq: 3400, q: 1.5 });
      break;
    case 'play':
      // Card sliding through the air, then slapping the felt.
      noise(t, 0.09, { gain: 0.12, filter: 'bandpass', freq: 1800, to: 4200, q: 0.9 });
      noise(t + 0.07, 0.05, { gain: 0.26, filter: 'lowpass', freq: 2400 });
      thump(t + 0.07, 170, 80, 0.09, 0.12);
      break;
    case 'pass':
      // Wood block.
      tone(520, t, 0.07, { type: 'sine', gain: 0.1, to: 400 });
      noise(t, 0.015, { gain: 0.12, filter: 'bandpass', freq: 1900, q: 2 });
      break;
    case 'slam':
      thump(t, 150, 42, 0.32, 0.5);
      noise(t, 0.2, { gain: 0.5, filter: 'lowpass', freq: 1800, to: 300 });
      noise(t, 0.03, { gain: 0.3, filter: 'highpass', freq: 2500 });
      break;
    case 'boom':
      thump(t, 130, 34, 0.55, 0.6);
      noise(t, 0.45, { gain: 0.6, filter: 'lowpass', freq: 1500, to: 180 });
      noise(t, 0.04, { gain: 0.35, filter: 'highpass', freq: 2200 });
      for (let i = 0; i < 6; i++) noise(t + 0.12 + Math.random() * 0.4, 0.02, { gain: 0.1, filter: 'bandpass', freq: 3000 + Math.random() * 3000, q: 3 });
      break;
    case 'boomBig':
      thump(t, 120, 28, 0.9, 0.7);
      thump(t + 0.01, 240, 50, 0.3, 0.3);
      noise(t, 0.8, { gain: 0.7, filter: 'lowpass', freq: 1300, to: 120 });
      noise(t, 0.05, { gain: 0.4, filter: 'highpass', freq: 2000 });
      for (let i = 0; i < 12; i++) noise(t + 0.15 + Math.random() * 0.7, 0.02, { gain: 0.12, filter: 'bandpass', freq: 2500 + Math.random() * 4000, q: 3 });
      break;
    case 'thunder':
      // The crack, then a long roll that rumbles away.
      noise(t, 0.09, { gain: 0.6, filter: 'highpass', freq: 1800 });
      noise(t + 0.03, 1.7, { gain: 0.7, filter: 'lowpass', freq: 900, to: 70, attack: 0.02 });
      thump(t + 0.03, 90, 26, 1.4, 0.6);
      noise(t + 0.5, 0.9, { gain: 0.3, filter: 'lowpass', freq: 400, to: 60, attack: 0.1 });
      break;
    case 'sparkle':
      // Rising pentatonic run on little bells.
      [10, 11, 12, 13, 14, 15, 17].forEach((s, i) => bell(penta(s), t + i * 0.055, 0.05, 0.6));
      noise(t, 0.5, { gain: 0.05, filter: 'highpass', freq: 6000, attack: 0.15 });
      break;
    case 'clang':
      // Steel plate.
      [1, 1.48, 2.37, 3.11].forEach((r, i) => tone(520 * r, t, 0.5 - i * 0.08, { type: 'square', gain: 0.03 }));
      noise(t, 0.04, { gain: 0.2, filter: 'highpass', freq: 3500 });
      break;
    case 'stamp':
      thump(t, 210, 85, 0.1, 0.4);
      noise(t, 0.06, { gain: 0.3, filter: 'lowpass', freq: 900 });
      break;
    case 'whoosh':
      noise(t, 0.42, { gain: 0.2, filter: 'bandpass', freq: 500, to: 3200, q: 1.4, attack: 0.12 });
      break;
    case 'brush':
      noise(t, 0.3, { gain: 0.12, filter: 'bandpass', freq: 2600, to: 1200, q: 0.7, attack: 0.05 });
      break;
    case 'gong': {
      // Inharmonic partials with a slow bloom and a falling pitch, like a large opera gong.
      const f = 98;
      [1, 1.47, 2.09, 2.56, 3.37, 4.16, 5.43].forEach((r, i) => {
        tone(f * r * 1.03, t, 2.6 - i * 0.25, { gain: 0.16 / (1 + i * 0.5), to: f * r * 0.985, attack: 0.02 + i * 0.004 });
      });
      noise(t, 0.5, { gain: 0.12, filter: 'bandpass', freq: 700, to: 300, q: 0.6 });
      break;
    }
    case 'turn':
      bell(penta(8), t, 0.06, 0.4);
      bell(penta(10), t + 0.1, 0.07, 0.55);
      break;
    case 'tick':
      tone(1150, t, 0.035, { type: 'square', gain: 0.025 });
      break;
    case 'alarm':
      tone(penta(9), t, 0.09, { type: 'triangle', gain: 0.06 });
      tone(penta(9), t + 0.13, 0.09, { type: 'triangle', gain: 0.06 });
      break;
    case 'finish':
      pluck(penta(5 + (o.step ?? 0)), t, 0.09, 0.5);
      pluck(penta(7 + (o.step ?? 0)), t + 0.09, 0.09, 0.6);
      break;
    case 'finishFirst':
      [5, 7, 8, 10, 12].forEach((s, i) => pluck(penta(s), t + i * 0.075, 0.1, 0.7));
      bell(penta(15), t + 0.4, 0.05, 1);
      break;
    case 'level':
      pluck(penta(5 + (o.step ?? 0)), t, 0.1, 0.45);
      break;
    case 'tribute':
      pluck(penta(9), t, 0.07, 0.5);
      pluck(penta(7), t + 0.1, 0.07, 0.6);
      break;
    case 'win':
      [5, 7, 8, 10, 12, 10, 12, 15].forEach((s, i) => pluck(penta(s), t + i * 0.1, 0.11, i === 7 ? 1.4 : 0.5));
      bell(penta(15), t + 0.72, 0.05, 1.5);
      break;
    case 'lose':
      [9, 8, 7, 5].forEach((s, i) => pluck(penta(s) * 0.5, t + i * 0.2, 0.09, 0.9));
      break;
    case 'fanfare': {
      const tune = [5, 5, 7, 8, 10, 8, 10, 12, 15];
      const times = [0, 0.14, 0.28, 0.42, 0.56, 0.78, 0.92, 1.06, 1.3];
      tune.forEach((s, i) => {
        pluck(penta(s), t + times[i]!, 0.12, i === tune.length - 1 ? 2 : 0.55);
        if (i % 2 === 0) pluck(penta(s - 5), t + times[i]!, 0.06, 0.7);
      });
      bell(penta(20), t + 1.32, 0.05, 2);
      break;
    }
  }
}
