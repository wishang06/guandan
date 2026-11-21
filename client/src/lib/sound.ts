import { KEYS, load, save } from './storage';

/**
 * Tiny synthesised sound effects (no audio files). The AudioContext is created on
 * the first user gesture, as mobile browsers require.
 */
export type SoundName = 'play' | 'pass' | 'bomb' | 'turn' | 'tick' | 'finish' | 'win' | 'deal';

let ctx: AudioContext | null = null;
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
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}

function tone(freq: number, start: number, dur: number, type: OscillatorType, gain: number) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(ctx.destination);
  o.start(start);
  o.stop(start + dur + 0.02);
}

function noise(start: number, dur: number, gain: number, cutoff: number) {
  if (!ctx) return;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = cutoff;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(ctx.destination);
  src.start(start);
}

export function playSound(name: SoundName) {
  if (muted || !ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  switch (name) {
    case 'play':
      noise(t, 0.07, 0.5, 3200);
      tone(520, t, 0.06, 'triangle', 0.05);
      break;
    case 'deal':
      for (let i = 0; i < 4; i++) noise(t + i * 0.05, 0.04, 0.3, 4000);
      break;
    case 'pass':
      tone(260, t, 0.12, 'sine', 0.06);
      break;
    case 'bomb':
      tone(90, t, 0.45, 'sawtooth', 0.12);
      noise(t, 0.4, 0.8, 900);
      break;
    case 'turn':
      tone(660, t, 0.12, 'sine', 0.08);
      tone(880, t + 0.11, 0.16, 'sine', 0.08);
      break;
    case 'tick':
      tone(1200, t, 0.03, 'square', 0.03);
      break;
    case 'finish':
      [523, 659, 784].forEach((f, i) => tone(f, t + i * 0.09, 0.2, 'triangle', 0.07));
      break;
    case 'win':
      [523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.12, 0.35, 'triangle', 0.08));
      break;
  }
}
