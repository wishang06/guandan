/** localStorage helpers that never throw (private mode, blocked storage, SSR). */
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown) {
  try {
    if (value === undefined || value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export const KEYS = {
  session: 'guandan:session',
  nickname: 'guandan:nickname',
  lang: 'guandan:lang',
  muted: 'guandan:muted',
} as const;
