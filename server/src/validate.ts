import {
  NICKNAME_MAX,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type Action,
  type ComboType,
  type RoomSettings,
  type Seat,
} from '@guandan/shared';

/** Validators for untrusted client payloads. Each returns null when invalid. */

const COMBO_TYPES: ReadonlySet<string> = new Set<ComboType>([
  'single',
  'pair',
  'triple',
  'fullHouse',
  'straight',
  'tube',
  'plate',
  'bomb',
  'straightFlush',
  'jokerBomb',
]);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

export function parseNickname(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  // Collapse whitespace and strip control characters.
  const name = v.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (name.length < 1) return null;
  return [...name].slice(0, NICKNAME_MAX).join('');
}

const CODE_RE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

export function parseCode(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const code = v.trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

export function parseToken(v: unknown): string | null {
  return typeof v === 'string' && /^[0-9a-f]{32}$/.test(v) ? v : null;
}

export function parseSeat(v: unknown): Seat | null {
  return isInt(v, 0, 3) ? (v as Seat) : null;
}

export function parseSettings(v: unknown): Partial<RoomSettings> | null {
  if (!isObj(v)) return null;
  const out: Partial<RoomSettings> = {};
  if (v.turnSeconds !== undefined) {
    if (!isInt(v.turnSeconds, 0, 300) || (v.turnSeconds > 0 && v.turnSeconds < 5)) return null;
    out.turnSeconds = v.turnSeconds;
  }
  if (v.aMaxFails !== undefined) {
    if (!isInt(v.aMaxFails, 0, 10)) return null;
    out.aMaxFails = v.aMaxFails;
  }
  return out;
}

export function parseAction(v: unknown): Action | null {
  if (!isObj(v)) return null;
  switch (v.type) {
    case 'pass':
      return { type: 'pass' };
    case 'tribute':
    case 'return':
      return isInt(v.cardId, 0, 107) ? { type: v.type, cardId: v.cardId } : null;
    case 'play': {
      const ids = v.cardIds;
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > 27) return null;
      if (!ids.every((id) => isInt(id, 0, 107))) return null;
      const action: Action = { type: 'play', cardIds: ids as number[] };
      if (v.choice !== undefined) {
        const c = v.choice;
        if (!isObj(c) || typeof c.type !== 'string' || !COMBO_TYPES.has(c.type)) return null;
        if (!isInt(c.rank, 0, 17) || !isInt(c.size, 1, 27)) return null;
        action.choice = { type: c.type as ComboType, rank: c.rank, size: c.size };
      }
      return action;
    }
    default:
      return null;
  }
}
