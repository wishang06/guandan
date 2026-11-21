import type { Card } from './cards';
import type { Combo, ComboKey } from './combos';
import type { Action, GameEvent, HandPhase, HandResult, Seat, Team, TrickEntry } from './game';

/** Room-level settings the host can change in the lobby. */
export interface RoomSettings {
  /** Seconds per turn; 0 disables the timer. */
  turnSeconds: number;
  /** Failed attempts at A before dropping back to 2; 0 = never. */
  aMaxFails: number;
}

export const DEFAULT_ROOM_SETTINGS: RoomSettings = { turnSeconds: 30, aMaxFails: 3 };
export const TURN_SECONDS_OPTIONS = [0, 15, 20, 30, 45, 60, 90] as const;
export const ROOM_CODE_LENGTH = 6;
/** Alphabet without look-alikes (no 0/O, 1/I/L). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const NICKNAME_MAX = 16;
/** How long a disconnected player's seat is held. */
export const RECONNECT_GRACE_MS = 2 * 60 * 1000;
/** How long the end-of-hand screen waits before dealing the next hand. */
export const NEXT_HAND_SECONDS = 30;

export interface SeatView {
  seat: Seat;
  occupied: boolean;
  playerId: string | null;
  nickname: string | null;
  isBot: boolean;
  isHost: boolean;
  ready: boolean;
  connected: boolean;
  /** The server is playing for this seat (bot, or a human who left / timed out). */
  autopilot: boolean;
}

export interface TributePaymentView {
  from: Seat;
  to: Seat | null;
  paid: boolean;
  returned: boolean;
  /** Public once every tribute card has been chosen (always visible to the payer). */
  card: Card | null;
  /** Only visible to the two players involved. */
  returnCard: Card | null;
}

export interface TributeView {
  kind: 'single' | 'double' | 'anti';
  receivers: Seat[];
  payments: TributePaymentView[];
}

export interface GameView {
  handNumber: number;
  level: number;
  declarer: Team | null;
  levels: [number, number];
  aFails: [number, number];
  phase: HandPhase;
  /** Whose turn it is in the play phase. */
  turn: Seat | null;
  leader: Seat;
  lastPlay: { seat: Seat; combo: Combo } | null;
  trick: TrickEntry[];
  cardCounts: [number, number, number, number];
  finishOrder: Seat[];
  /** Your own cards (empty for spectators). Nobody else's hand is ever sent. */
  myHand: Card[];
  tribute: TributeView | null;
  /** Seats that still owe an action in this phase. */
  pending: Seat[];
  /** Server epoch ms when the current decision times out (null = no timer). */
  deadline: number | null;
  lastResult: HandResult | null;
  winner: Team | null;
  events: GameEvent[];
  /** Seats that have confirmed the end-of-hand screen. */
  nextReady: Seat[];
}

export interface RoomView {
  code: string;
  status: 'lobby' | 'playing';
  hostId: string;
  seats: SeatView[];
  settings: RoomSettings;
  you: { playerId: string; seat: Seat | null; isHost: boolean };
  game: GameView | null;
  /** Server clock at send time, so clients can correct timer drift. */
  serverTime: number;
}

export interface SessionInfo {
  code: string;
  playerId: string;
  /** Secret used to reclaim the seat after a reconnect. Keep it in localStorage. */
  token: string;
}

export type ErrorCode =
  | 'bad_request'
  | 'room_not_found'
  | 'room_full'
  | 'game_in_progress'
  | 'not_in_room'
  | 'not_host'
  | 'seat_taken'
  | 'not_enough_players'
  | 'players_not_ready'
  | 'invalid_session'
  | 'not_seated'
  | 'no_game'
  | import('./game').ActionError;

export type Ack<T = undefined> = { ok: true; data: T } | { ok: false; error: ErrorCode; options?: Combo[] };

export interface ClientToServerEvents {
  'room:create': (p: { nickname: string }, ack: (r: Ack<SessionInfo>) => void) => void;
  'room:join': (p: { code: string; nickname: string }, ack: (r: Ack<SessionInfo>) => void) => void;
  'room:resume': (p: { code: string; token: string }, ack: (r: Ack<SessionInfo>) => void) => void;
  'room:leave': (ack: (r: Ack) => void) => void;
  'room:seat': (p: { seat: Seat }, ack: (r: Ack) => void) => void;
  'room:ready': (p: { ready: boolean }, ack: (r: Ack) => void) => void;
  'room:settings': (p: Partial<RoomSettings>, ack: (r: Ack) => void) => void;
  'room:start': (ack: (r: Ack) => void) => void;
  'game:action': (p: Action, ack: (r: Ack) => void) => void;
  'game:next': (ack: (r: Ack) => void) => void;
  'game:newMatch': (ack: (r: Ack) => void) => void;
}

export interface ServerToClientEvents {
  'room:state': (view: RoomView) => void;
  /** This session was opened elsewhere (another tab or device). */
  'session:replaced': () => void;
}

export type { Action, ComboKey };
