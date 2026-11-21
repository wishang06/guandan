import { randomBytes, randomInt } from 'node:crypto';
import {
  DEFAULT_ROOM_SETTINGS,
  NEXT_HAND_SECONDS,
  RECONNECT_GRACE_MS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  SEATS,
  applyAction,
  botDecide,
  buildGameView,
  createMatch,
  isBomb,
  pendingSeats,
  startNextHand,
  timeoutAction,
  type Ack,
  type Action,
  type ErrorCode,
  type MatchState,
  type RoomSettings,
  type RoomView,
  type Seat,
  type SeatView,
} from '@guandan/shared';

export interface Member {
  playerId: string;
  token: string;
  nickname: string;
  seat: Seat | null;
  ready: boolean;
  connected: boolean;
  socketId: string | null;
  disconnectedAt: number | null;
  isBot: boolean;
  /** Server plays for this seat (bots, or humans who left / exceeded the grace period). */
  autopilot: boolean;
  /** Left the game for good; the session token no longer works. */
  left: boolean;
  graceTimer: ReturnType<typeof setTimeout> | null;
}

export class Room {
  hostId = '';
  readonly members = new Map<string, Member>();
  readonly seats: (string | null)[] = [null, null, null, null];
  settings: RoomSettings = { ...DEFAULT_ROOM_SETTINGS };
  status: 'lobby' | 'playing' = 'lobby';
  match: MatchState | null = null;
  deadline: number | null = null;
  decisionKey = '';
  readonly nextReady = new Set<Seat>();
  /** Hand number that was last dealt, and when play may begin after its deal. */
  dealtHand = 0;
  playFrom = 0;
  turnTimer: ReturnType<typeof setTimeout> | null = null;
  autoTimer: ReturnType<typeof setTimeout> | null = null;
  nextTimer: ReturnType<typeof setTimeout> | null = null;
  lastActivity = Date.now();

  constructor(readonly code: string) {}

  memberAt(seat: Seat): Member | null {
    const id = this.seats[seat];
    return id ? (this.members.get(id) ?? null) : null;
  }

  humans(): Member[] {
    return [...this.members.values()].filter((m) => !m.isBot);
  }
}

export type Result<T = undefined> = Ack<T>;

const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const err = (error: ErrorCode): { ok: false; error: ErrorCode } => ({ ok: false, error });

/** Decides a move for a seat the server plays (bots / autopilot). */
export type DecidePolicy = (match: MatchState, seat: Seat) => Action | null;

export interface RoomManagerOptions {
  /** Delay before the server moves for an autopilot seat. */
  autoDelayMs?: number;
  /** How long a disconnected human keeps their seat before being removed / put on autopilot. */
  graceMs?: number;
  /** Rooms with nobody connected are deleted after this long. */
  idleRoomMs?: number;
  nextHandSeconds?: number;
  /** Pause after each deal before bots move and the turn timer starts (deal animation). */
  dealPauseMs?: number;
  /** Extra bot think time after a bomb (×3 after four jokers). */
  bombPauseMs?: number;
  decide?: DecidePolicy;
  onChange?: (room: Room) => void;
  /** Called when a room is deleted (so sockets can be told). */
  onDelete?: (room: Room) => void;
}

const newId = (bytes: number) => randomBytes(bytes).toString('hex');

const BOT_NAMES = ['Bot Pearl', 'Bot Jade', 'Bot Amber', 'Bot Coral', 'Bot Onyx', 'Bot Ivory'];

function botName(room: Room): string {
  const used = new Set([...room.members.values()].map((m) => m.nickname));
  return BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${room.members.size + 1}`;
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  onChange: (room: Room) => void;
  onDelete: (room: Room) => void;
  private readonly autoDelayMs: number;
  private readonly graceMs: number;
  private readonly idleRoomMs: number;
  private readonly nextHandMs: number;
  private readonly dealPauseMs: number;
  private readonly bombPauseMs: number;
  decide: DecidePolicy;

  constructor(opts: RoomManagerOptions = {}) {
    this.autoDelayMs = opts.autoDelayMs ?? 900;
    this.graceMs = opts.graceMs ?? RECONNECT_GRACE_MS;
    this.idleRoomMs = opts.idleRoomMs ?? 15 * 60 * 1000;
    this.nextHandMs = (opts.nextHandSeconds ?? NEXT_HAND_SECONDS) * 1000;
    this.dealPauseMs = opts.dealPauseMs ?? 2600;
    this.bombPauseMs = opts.bombPauseMs ?? 800;
    this.decide = opts.decide ?? botDecide;
    this.onChange = opts.onChange ?? (() => {});
    this.onDelete = opts.onDelete ?? (() => {});
  }

  // ---------------------------------------------------------------- lobby

  create(nickname: string): Result<{ room: Room; member: Member }> {
    let code: string;
    do {
      code = Array.from({ length: ROOM_CODE_LENGTH }, () => ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)]).join('');
    } while (this.rooms.has(code));
    const room = new Room(code);
    this.rooms.set(code, room);
    const member = this.addMember(room, nickname, 0);
    room.hostId = member.playerId;
    return ok({ room, member });
  }

  join(code: string, nickname: string): Result<{ room: Room; member: Member }> {
    const room = this.rooms.get(code);
    if (!room) return err('room_not_found');
    if (room.status !== 'lobby') return err('game_in_progress');
    let seat = SEATS.find((s) => room.seats[s] === null);
    if (seat === undefined) {
      // A full table with bots: the newcomer takes the first bot's seat.
      const bot = SEATS.map((s) => room.memberAt(s)).find((m) => m?.isBot);
      if (!bot) return err('room_full');
      seat = bot.seat!;
      this.removeMember(room, bot, false);
    }
    const member = this.addMember(room, nickname, seat);
    this.changed(room);
    return ok({ room, member });
  }

  resume(code: string, token: string): Result<{ room: Room; member: Member }> {
    const room = this.rooms.get(code);
    if (!room) return err('room_not_found');
    const member = [...room.members.values()].find((m) => m.token === token && !m.isBot);
    if (!member || member.left) return err('invalid_session');
    return ok({ room, member });
  }

  /** Bind a socket to a member. Returns the socket id it replaced, if any. */
  connect(room: Room, member: Member, socketId: string): string | null {
    const previous = member.socketId;
    member.socketId = socketId;
    member.connected = true;
    member.disconnectedAt = null;
    if (member.graceTimer) clearTimeout(member.graceTimer);
    member.graceTimer = null;
    if (room.status === 'playing' && member.autopilot && !member.isBot && !member.left) {
      member.autopilot = false; // reclaim the seat from autopilot
    }
    this.afterChange(room);
    return previous && previous !== socketId ? previous : null;
  }

  disconnect(code: string, playerId: string, socketId: string) {
    const room = this.rooms.get(code);
    const member = room?.members.get(playerId);
    if (!room || !member || member.socketId !== socketId) return;
    member.socketId = null;
    member.connected = false;
    member.disconnectedAt = Date.now();
    if (member.graceTimer) clearTimeout(member.graceTimer);
    member.graceTimer = setTimeout(() => this.graceExpired(room, member), this.graceMs);
    this.changed(room);
  }

  private graceExpired(room: Room, member: Member) {
    member.graceTimer = null;
    if (member.connected || !this.rooms.has(room.code)) return;
    if (room.status === 'lobby') {
      this.removeMember(room, member);
    } else {
      member.autopilot = true;
      this.transferHostIfNeeded(room);
      this.afterChange(room);
    }
  }

  leave(code: string, playerId: string): Result {
    const room = this.rooms.get(code);
    const member = room?.members.get(playerId);
    if (!room || !member) return err('not_in_room');
    if (member.graceTimer) clearTimeout(member.graceTimer);
    if (room.status === 'lobby') {
      this.removeMember(room, member);
    } else {
      member.left = true;
      member.autopilot = true;
      member.connected = false;
      member.socketId = null;
      if (room.humans().every((m) => m.left)) {
        this.deleteRoom(room);
        return ok(undefined);
      }
      this.transferHostIfNeeded(room);
      this.afterChange(room);
    }
    return ok(undefined);
  }

  setSeat(code: string, playerId: string, seat: Seat): Result {
    const found = this.lobbyMember(code, playerId);
    if (!found.ok) return found;
    const { room, member } = found.data;
    if (room.seats[seat] !== null && room.seats[seat] !== playerId) return err('seat_taken');
    if (member.seat !== null) room.seats[member.seat] = null;
    room.seats[seat] = playerId;
    member.seat = seat;
    this.changed(room);
    return ok(undefined);
  }

  /** Host adds a bot to an empty seat. */
  addBot(code: string, playerId: string, seat: Seat): Result {
    const found = this.lobbyMember(code, playerId);
    if (!found.ok) return found;
    const { room } = found.data;
    if (room.hostId !== playerId) return err('not_host');
    if (room.seats[seat] !== null) return err('seat_taken');
    this.addMember(room, botName(room), seat, true);
    this.changed(room);
    return ok(undefined);
  }

  /** Host removes a bot. */
  removeBot(code: string, playerId: string, seat: Seat): Result {
    const found = this.lobbyMember(code, playerId);
    if (!found.ok) return found;
    const { room } = found.data;
    if (room.hostId !== playerId) return err('not_host');
    const bot = room.memberAt(seat);
    if (!bot?.isBot) return err('bad_request');
    this.removeMember(room, bot);
    return ok(undefined);
  }

  /** Host fills every empty seat with a bot. */
  fillBots(code: string, playerId: string): Result {
    const found = this.lobbyMember(code, playerId);
    if (!found.ok) return found;
    const { room } = found.data;
    if (room.hostId !== playerId) return err('not_host');
    for (const s of SEATS) if (room.seats[s] === null) this.addMember(room, botName(room), s, true);
    this.changed(room);
    return ok(undefined);
  }

  setReady(code: string, playerId: string, ready: boolean): Result {
    const found = this.lobbyMember(code, playerId);
    if (!found.ok) return found;
    found.data.member.ready = ready;
    this.changed(found.data.room);
    return ok(undefined);
  }

  updateSettings(code: string, playerId: string, patch: Partial<RoomSettings>): Result {
    const found = this.lobbyMember(code, playerId);
    if (!found.ok) return found;
    const { room } = found.data;
    if (room.hostId !== playerId) return err('not_host');
    room.settings = { ...room.settings, ...patch };
    this.changed(room);
    return ok(undefined);
  }

  start(code: string, playerId: string, opts: { seed?: number } = {}): Result {
    const found = this.lobbyMember(code, playerId);
    if (!found.ok) return found;
    const { room } = found.data;
    if (room.hostId !== playerId) return err('not_host');
    if (room.seats.some((s) => s === null)) return err('not_enough_players');
    const unready = room.humans().some((m) => m.playerId !== room.hostId && !m.ready);
    if (unready) return err('players_not_ready');
    room.match = createMatch({ seed: opts.seed, config: { aMaxFails: room.settings.aMaxFails } });
    room.status = 'playing';
    room.decisionKey = '';
    room.dealtHand = 0;
    room.nextReady.clear();
    this.afterChange(room);
    return ok(undefined);
  }

  // ---------------------------------------------------------------- game

  act(code: string, playerId: string, action: Action): Result {
    const found = this.playingMember(code, playerId);
    if (!found.ok) return found;
    const { room, member } = found.data;
    const r = applyAction(room.match!, member.seat!, action);
    if (!r.ok) return r.options ? { ok: false, error: r.error, options: r.options } : err(r.error);
    room.match = r.state;
    this.afterChange(room);
    return ok(undefined);
  }

  /** Confirm the end-of-hand screen; the next hand starts once every human confirmed. */
  nextHand(code: string, playerId: string): Result {
    const found = this.playingMember(code, playerId);
    if (!found.ok) return found;
    const { room, member } = found.data;
    const m = room.match!;
    if (m.hand.phase !== 'done' || m.winner !== null) return err('wrong_phase');
    room.nextReady.add(member.seat!);
    if (!this.maybeStartNext(room)) this.changed(room);
    return ok(undefined);
  }

  /** After a match is won, the host returns everyone to the lobby for a new match. */
  newMatch(code: string, playerId: string): Result {
    const room = this.rooms.get(code);
    if (!room) return err('room_not_found');
    if (!room.members.has(playerId)) return err('not_in_room');
    if (room.hostId !== playerId) return err('not_host');
    if (room.status !== 'playing' || !room.match || room.match.winner === null) return err('wrong_phase');
    this.clearTimers(room);
    room.status = 'lobby';
    room.match = null;
    room.deadline = null;
    room.nextReady.clear();
    // Players who left during the match free their seats.
    for (const m of [...room.members.values()]) {
      if (m.left) this.removeMember(room, m, false);
      else if (!m.isBot) {
        m.ready = false;
        m.autopilot = false;
      }
    }
    this.changed(room);
    return ok(undefined);
  }

  // ---------------------------------------------------------------- views

  viewFor(room: Room, playerId: string): RoomView {
    const me = room.members.get(playerId);
    const seats: SeatView[] = SEATS.map((seat) => {
      const m = room.memberAt(seat);
      return {
        seat,
        occupied: !!m,
        playerId: m?.playerId ?? null,
        nickname: m?.nickname ?? null,
        isBot: m?.isBot ?? false,
        isHost: !!m && m.playerId === room.hostId,
        ready: m ? m.isBot || m.ready : false,
        connected: m ? m.isBot || m.connected : false,
        autopilot: m ? m.isBot || m.autopilot : false,
      };
    });
    const seat = me?.seat ?? null;
    return {
      code: room.code,
      status: room.status,
      hostId: room.hostId,
      seats,
      settings: { ...room.settings },
      you: { playerId, seat, isHost: room.hostId === playerId },
      game: room.match
        ? buildGameView(room.match, seat, { deadline: room.deadline, nextReady: [...room.nextReady] })
        : null,
      serverTime: Date.now(),
    };
  }

  // ---------------------------------------------------------------- housekeeping

  /** Delete rooms nobody has been connected to for a while. */
  sweep(now = Date.now()) {
    for (const room of [...this.rooms.values()]) {
      const anyoneHere = room.humans().some((m) => m.connected);
      if (!anyoneHere && now - room.lastActivity > this.idleRoomMs) this.deleteRoom(room);
    }
  }

  dispose() {
    for (const room of [...this.rooms.values()]) this.deleteRoom(room);
  }

  // ---------------------------------------------------------------- internals

  protected addMember(room: Room, nickname: string, seat: Seat, isBot = false): Member {
    const member: Member = {
      playerId: newId(8),
      token: newId(16),
      nickname,
      seat,
      ready: isBot,
      connected: isBot,
      socketId: null,
      disconnectedAt: null,
      isBot,
      autopilot: isBot,
      left: false,
      graceTimer: null,
    };
    room.members.set(member.playerId, member);
    room.seats[seat] = member.playerId;
    return member;
  }

  protected removeMember(room: Room, member: Member, notify = true) {
    if (member.graceTimer) clearTimeout(member.graceTimer);
    if (member.seat !== null && room.seats[member.seat] === member.playerId) room.seats[member.seat] = null;
    room.members.delete(member.playerId);
    if (room.humans().length === 0) {
      this.deleteRoom(room);
      return;
    }
    this.transferHostIfNeeded(room);
    if (notify) this.changed(room);
  }

  private transferHostIfNeeded(room: Room) {
    const host = room.members.get(room.hostId);
    if (host && !host.isBot && !host.left && (host.connected || room.status === 'lobby')) return;
    const humans = room.humans().filter((m) => !m.left);
    const next = humans.find((m) => m.connected) ?? humans[0];
    if (next) room.hostId = next.playerId;
  }

  protected deleteRoom(room: Room) {
    this.clearTimers(room);
    for (const m of room.members.values()) if (m.graceTimer) clearTimeout(m.graceTimer);
    if (this.rooms.delete(room.code)) this.onDelete(room);
  }

  private clearTimers(room: Room) {
    for (const t of [room.turnTimer, room.autoTimer, room.nextTimer]) if (t) clearTimeout(t);
    room.turnTimer = room.autoTimer = room.nextTimer = null;
    room.decisionKey = '';
  }

  protected lobbyMember(code: string, playerId: string): Result<{ room: Room; member: Member }> {
    const room = this.rooms.get(code);
    if (!room) return err('room_not_found');
    const member = room.members.get(playerId);
    if (!member) return err('not_in_room');
    if (room.status !== 'lobby') return err('game_in_progress');
    return ok({ room, member });
  }

  private playingMember(code: string, playerId: string): Result<{ room: Room; member: Member }> {
    const room = this.rooms.get(code);
    if (!room) return err('room_not_found');
    const member = room.members.get(playerId);
    if (!member) return err('not_in_room');
    if (room.status !== 'playing' || !room.match) return err('no_game');
    if (member.seat === null) return err('not_seated');
    return ok({ room, member });
  }

  protected isAuto(room: Room, seat: Seat): boolean {
    const m = room.memberAt(seat);
    return !m || m.isBot || m.autopilot;
  }

  protected changed(room: Room) {
    room.lastActivity = Date.now();
    this.onChange(room);
  }

  protected afterChange(room: Room) {
    if (!this.rooms.has(room.code)) return;
    this.schedule(room);
    this.changed(room);
  }

  /** (Re)arm the turn timer, the autopilot timer and the next-hand timer. */
  private schedule(room: Room) {
    const m = room.match;
    if (room.autoTimer) clearTimeout(room.autoTimer);
    room.autoTimer = null;
    if (!m || room.status !== 'playing') {
      this.clearTimers(room);
      room.deadline = null;
      return;
    }
    const hand = m.hand;
    if (hand.number !== room.dealtHand) {
      room.dealtHand = hand.number;
      room.playFrom = Date.now() + this.dealPauseMs;
    }
    const pause = Math.max(0, room.playFrom - Date.now());
    const key = hand.phase === 'play' ? `${hand.number}|play|${m.eventSeq}` : `${hand.number}|${hand.phase}`;
    if (key !== room.decisionKey) {
      room.decisionKey = key;
      for (const t of [room.turnTimer, room.nextTimer]) if (t) clearTimeout(t);
      room.turnTimer = room.nextTimer = null;
      room.deadline = null;
      if (hand.phase === 'done') {
        if (m.winner === null) {
          room.deadline = Date.now() + this.nextHandMs;
          room.nextTimer = setTimeout(() => this.startNext(room), this.nextHandMs);
        }
      } else if (room.settings.turnSeconds > 0) {
        const ms = room.settings.turnSeconds * 1000 + pause;
        room.deadline = Date.now() + ms;
        room.turnTimer = setTimeout(() => this.onTimeout(room), ms);
      }
    }
    if (hand.phase !== 'done' && pendingSeats(m).some((s) => this.isAuto(room, s))) {
      // Let a bomb land before the next seat answers (longer for four jokers).
      const last = hand.lastPlay?.combo;
      const awe = !last || !isBomb(last) || this.bombPauseMs === 0 ? 0 : last.type === 'jokerBomb' ? this.bombPauseMs * 3 : this.bombPauseMs;
      const delay = pause + awe + this.autoDelayMs * (0.8 + Math.random() * 0.4);
      room.autoTimer = setTimeout(() => this.runAutopilot(room), delay);
    }
  }

  private onTimeout(room: Room) {
    room.turnTimer = null;
    const m = room.match;
    if (!m || !this.rooms.has(room.code)) return;
    let state = m;
    for (const seat of pendingSeats(m)) {
      const action = timeoutAction(state, seat);
      if (!action) continue;
      const r = applyAction(state, seat, action);
      if (r.ok) state = r.state;
    }
    room.match = state;
    this.afterChange(room);
  }

  private runAutopilot(room: Room) {
    room.autoTimer = null;
    const m = room.match;
    if (!m || !this.rooms.has(room.code)) return;
    let state = m;
    for (const seat of pendingSeats(m).filter((s) => this.isAuto(room, s))) {
      let r = null;
      const choice = this.decide(state, seat);
      if (choice) r = applyAction(state, seat, choice);
      if (!r || !r.ok) {
        const fallback = timeoutAction(state, seat);
        if (fallback) r = applyAction(state, seat, fallback);
      }
      if (r?.ok) state = r.state;
    }
    room.match = state;
    this.afterChange(room);
  }

  /** Start the next hand if every connected human has confirmed. */
  private maybeStartNext(room: Room): boolean {
    const m = room.match;
    if (!m || m.hand.phase !== 'done' || m.winner !== null) return false;
    const waiting = SEATS.filter((s) => {
      const member = room.memberAt(s);
      return member && !member.isBot && !member.autopilot && member.connected && !room.nextReady.has(s);
    });
    if (waiting.length > 0) return false;
    this.startNext(room);
    return true;
  }

  private startNext(room: Room) {
    room.nextTimer = null;
    const m = room.match;
    if (!m || m.hand.phase !== 'done' || m.winner !== null || !this.rooms.has(room.code)) return;
    room.match = startNextHand(m);
    room.nextReady.clear();
    this.afterChange(room);
  }
}
