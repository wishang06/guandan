import { describe, expect, it } from 'vitest';
import { parseAction, parseCode, parseNickname, parseSettings } from './validate';
import { originMatcher } from './app';

describe('payload validation', () => {
  it('cleans nicknames', () => {
    expect(parseNickname('  Ann   Lee ')).toBe('Ann Lee');
    expect(parseNickname('a\u0000b')).toBe('ab');
    expect(parseNickname('掼蛋高手掼蛋高手掼蛋高手掼蛋高手掼蛋')).toHaveLength(16);
    expect(parseNickname('')).toBeNull();
    expect(parseNickname(42)).toBeNull();
  });

  it('normalises room codes', () => {
    expect(parseCode(' abcdef ')).toBe('ABCDEF');
    expect(parseCode('ABCDE0')).toBeNull(); // 0 is not in the alphabet
    expect(parseCode('ABC')).toBeNull();
  });

  it('accepts only well-formed actions', () => {
    expect(parseAction({ type: 'pass' })).toEqual({ type: 'pass' });
    expect(parseAction({ type: 'play', cardIds: [1, 2] })).toEqual({ type: 'play', cardIds: [1, 2] });
    expect(parseAction({ type: 'play', cardIds: [1], choice: { type: 'pair', rank: 9, size: 2 } })).toMatchObject({
      choice: { type: 'pair' },
    });
    expect(parseAction({ type: 'play', cardIds: [] })).toBeNull();
    expect(parseAction({ type: 'play', cardIds: [1.5] })).toBeNull();
    expect(parseAction({ type: 'play', cardIds: [1], choice: { type: 'nope', rank: 1, size: 1 } })).toBeNull();
    expect(parseAction({ type: 'tribute', cardId: 200 })).toBeNull();
    expect(parseAction({ type: 'hack' })).toBeNull();
    expect(parseAction(null)).toBeNull();
  });

  it('bounds settings', () => {
    expect(parseSettings({ turnSeconds: 30 })).toEqual({ turnSeconds: 30 });
    expect(parseSettings({ turnSeconds: 0 })).toEqual({ turnSeconds: 0 });
    expect(parseSettings({ turnSeconds: 2 })).toBeNull();
    expect(parseSettings({ aMaxFails: 99 })).toBeNull();
  });

  it('matches CORS origins with wildcards', () => {
    const allow = originMatcher(['https://guandan.vercel.app', 'https://*.vercel.app']);
    expect(allow('https://guandan.vercel.app')).toBe(true);
    expect(allow('https://guandan-git-feat-x.vercel.app')).toBe(true);
    expect(allow('https://evil.com')).toBe(false);
    expect(allow('https://x.vercel.app.evil.com')).toBe(false);
    expect(originMatcher([])('https://anything')).toBe(true);
  });
});
