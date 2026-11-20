import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMatch, makeCardFactory, makeCards, type Card, type Seat } from '@guandan/shared';
import { RoomManager, type Member, type Room } from './rooms';

let mgr: RoomManager;
let changes: number;

beforeEach(() => {
  vi.useFakeTimers();
  changes = 0;
  mgr = new RoomManager({ autoDelayMs: 500, onChange: () => changes++ });
});

afterEach(() => {
  mgr.dispose();
  vi.useRealTimers();
});

function ok<T>(r: { ok: true; data: T } | { ok: false; error: string }): T {
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

/** A room with `n` connected humans; everyone but the host is ready. */
function setupRoom(n = 4): { room: Room; members: Member[] } {
  const { room, member } = ok(mgr.create('P0'));
  mgr.connect(room, member, 'sock0');
  const members = [member];
  for (let i = 1; i < n; i++) {
    const m = ok(mgr.join(room.code, `P${i}`)).member;
    mgr.connect(room, m, `sock${i}`);
    ok(mgr.setReady(room.code, m.playerId, true));
    members.push(m);
  }
  return { room, members };
}

function startGame(seed = 1) {
  const s = setupRoom();
  ok(mgr.start(s.room.code, s.members[0]!.playerId, { seed }));
  return s;
}

function hands(specs: string[]): Card[][] {
  const f = makeCardFactory();
  return specs.map((x) => makeCards(x, f));
}

const memberAtTurn = (room: Room) => room.memberAt(room.match!.hand.turn)!;

describe('lobby', () => {
  it('creates a room with a 6-character code and seats players in order', () => {
    const { room, members } = setupRoom(3);
    expect(room.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(members.map((m) => m.seat)).toEqual([0, 1, 2]);
    expect(room.hostId).toBe(members[0]!.playerId);
    const view = mgr.viewFor(room, members[1]!.playerId);
    expect(view.seats.map((s) => s.nickname)).toEqual(['P0', 'P1', 'P2', null]);
    expect(view.seats[0]!.isHost).toBe(true);
    expect(view.you).toMatchObject({ seat: 1, isHost: false });
  });

  it('rejects unknown rooms, a fifth player and joins mid-game', () => {
    const { room, members } = setupRoom(4);
    expect(mgr.join('ZZZZZZ', 'x')).toMatchObject({ ok: false, error: 'room_not_found' });
    expect(mgr.join(room.code, 'P5')).toMatchObject({ ok: false, error: 'room_full' });
    ok(mgr.start(room.code, members[0]!.playerId));
    expect(mgr.join(room.code, 'late')).toMatchObject({ ok: false, error: 'game_in_progress' });
  });

  it('lets players pick a free seat', () => {
    const { room, members } = setupRoom(2);
    expect(mgr.setSeat(room.code, members[1]!.playerId, 0)).toMatchObject({ ok: false, error: 'seat_taken' });
    ok(mgr.setSeat(room.code, members[1]!.playerId, 3));
    expect(room.seats).toEqual([members[0]!.playerId, null, null, members[1]!.playerId]);
  });

  it('only the host can start, with 4 seated players who are ready', () => {
    const { room, members } = setupRoom(3);
    expect(mgr.start(room.code, members[0]!.playerId)).toMatchObject({ ok: false, error: 'not_enough_players' });
    const p3 = ok(mgr.join(room.code, 'P3')).member;
    expect(mgr.start(room.code, members[1]!.playerId)).toMatchObject({ ok: false, error: 'not_host' });
    expect(mgr.start(room.code, members[0]!.playerId)).toMatchObject({ ok: false, error: 'players_not_ready' });
    ok(mgr.setReady(room.code, p3.playerId, true));
    ok(mgr.start(room.code, members[0]!.playerId));
    expect(room.status).toBe('playing');
  });

  it('only the host changes settings', () => {
    const { room, members } = setupRoom(2);
    expect(mgr.updateSettings(room.code, members[1]!.playerId, { turnSeconds: 10 })).toMatchObject({
      ok: false,
      error: 'not_host',
    });
    ok(mgr.updateSettings(room.code, members[0]!.playerId, { turnSeconds: 10, aMaxFails: 0 }));
    expect(room.settings).toEqual({ turnSeconds: 10, aMaxFails: 0 });
  });

  it('leaving frees the seat and passes host to someone else', () => {
    const { room, members } = setupRoom(3);
    ok(mgr.leave(room.code, members[0]!.playerId));
    expect(room.seats[0]).toBeNull();
    expect(room.hostId).toBe(members[1]!.playerId);
  });

  it('deletes the room when the last human leaves', () => {
    const { room, members } = setupRoom(1);
    ok(mgr.leave(room.code, members[0]!.playerId));
    expect(mgr.rooms.has(room.code)).toBe(false);
  });
});

describe('hidden information', () => {
  it('deals 27 cards and each view only contains your own hand', () => {
    const { room, members } = startGame();
    const match = room.match!;
    for (const m of members) {
      const view = mgr.viewFor(room, m.playerId);
      const game = view.game!;
      expect(game.myHand).toEqual(match.hand.hands[m.seat!]);
      expect(game.cardCounts).toEqual([27, 27, 27, 27]);
      const json = JSON.stringify(view);
      expect(json).not.toContain('"hands"');
      expect(json).not.toContain('"token"');
      for (const other of members) {
        if (other === m) continue;
        for (const c of match.hand.hands[other.seat!]!) {
          expect(json).not.toContain(`{"id":${c.id},`);
        }
      }
    }
  });
});

describe('game actions', () => {
  it('validates turns through the rules engine', () => {
    const { room } = startGame();
    const turn = memberAtTurn(room);
    const other = room.memberAt(((turn.seat! + 1) % 4) as Seat)!;
    expect(mgr.act(room.code, other.playerId, { type: 'pass' })).toMatchObject({ ok: false, error: 'not_your_turn' });
    const lowest = room.match!.hand.hands[turn.seat!]![0]!;
    ok(mgr.act(room.code, turn.playerId, { type: 'play', cardIds: [lowest.id] }));
    const view = mgr.viewFor(room, other.playerId);
    expect(view.game!.lastPlay?.seat).toBe(turn.seat);
    expect(view.game!.cardCounts[turn.seat!]).toBe(26);
  });

  it('returns the options for an ambiguous wild play', () => {
    const { room, members } = startGame();
    room.match = createMatch({
      hands: hands(['H2 H2 S3 D3 S4 D4 S9', 'S5', 'S6', 'S7']),
      firstLeader: 0,
    });
    const ids = room.match.hand.hands[0]!.filter((c) => c.rank !== 9).map((c) => c.id);
    const r = mgr.act(room.code, members[0]!.playerId, { type: 'play', cardIds: ids });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('ambiguous');
    expect(r.options?.map((o) => o.type).sort()).toEqual(['plate', 'tube']);
  });
});

describe('turn timer', () => {
  it('plays the lowest single when the leader times out, then auto-passes', () => {
    const { room } = startGame();
    const leader = room.match!.hand.turn;
    const view = mgr.viewFor(room, memberAtTurn(room).playerId);
    expect(view.game!.deadline).toBe(Date.now() + 30_000);
    vi.advanceTimersByTime(29_999);
    expect(room.match!.hand.lastPlay).toBeNull();
    vi.advanceTimersByTime(1);
    expect(room.match!.hand.lastPlay).toMatchObject({ seat: leader, combo: { type: 'single' } });
    vi.advanceTimersByTime(30_000);
    expect(room.match!.hand.trick.at(-1)).toMatchObject({ combo: null });
  });

  it('honours a custom timer and can be disabled', () => {
    const s = setupRoom();
    ok(mgr.updateSettings(s.room.code, s.members[0]!.playerId, { turnSeconds: 0 }));
    ok(mgr.start(s.room.code, s.members[0]!.playerId));
    expect(mgr.viewFor(s.room, s.members[0]!.playerId).game!.deadline).toBeNull();
    vi.advanceTimersByTime(10 * 60_000);
    expect(s.room.match!.hand.lastPlay).toBeNull();
  });
});

describe('reconnect', () => {
  it('holds a lobby seat for 2 minutes, then frees it', () => {
    const { room, members } = setupRoom(3);
    const p2 = members[2]!;
    mgr.disconnect(room.code, p2.playerId, 'sock2');
    vi.advanceTimersByTime(119_000);
    expect(room.seats[2]).toBe(p2.playerId);
    const back = ok(mgr.resume(room.code, p2.token));
    expect(back.member.seat).toBe(2);
    mgr.connect(back.room, back.member, 'sock2b');
    vi.advanceTimersByTime(60_000);
    expect(room.seats[2]).toBe(p2.playerId);

    mgr.disconnect(room.code, p2.playerId, 'sock2b');
    vi.advanceTimersByTime(120_000);
    expect(room.seats[2]).toBeNull();
    expect(mgr.resume(room.code, p2.token)).toMatchObject({ ok: false, error: 'invalid_session' });
  });

  it('ignores a stale socket disconnecting after a newer one connected', () => {
    const { room, members } = setupRoom(2);
    const p1 = members[1]!;
    mgr.connect(room, p1, 'newer');
    mgr.disconnect(room.code, p1.playerId, 'sock1');
    expect(p1.connected).toBe(true);
  });

  it('rejects a bad token', () => {
    const { room } = setupRoom(2);
    expect(mgr.resume(room.code, 'f'.repeat(32))).toMatchObject({ ok: false, error: 'invalid_session' });
  });

  it('puts an in-game player on autopilot after the grace period; reconnecting reclaims the seat', () => {
    const { room } = startGame();
    const turn = memberAtTurn(room);
    mgr.disconnect(room.code, turn.playerId, `sock${turn.seat}`);
    // During the grace period the normal turn timer still applies.
    vi.advanceTimersByTime(30_000);
    expect(room.match!.hand.lastPlay?.seat).toBe(turn.seat);
    vi.advanceTimersByTime(90_000);
    expect(turn.autopilot).toBe(true);
    expect(mgr.viewFor(room, turn.playerId).seats[turn.seat!]!.autopilot).toBe(true);
    const back = ok(mgr.resume(room.code, turn.token));
    mgr.connect(back.room, back.member, 'again');
    expect(turn.autopilot).toBe(false);
    expect(mgr.viewFor(room, turn.playerId).game!.myHand.length).toBe(room.match!.hand.hands[turn.seat!]!.length);
  });

  it('autopilot seats act after a short delay instead of the full timer', () => {
    const { room, members } = startGame();
    for (const m of members) m.autopilot = true;
    room.match = createMatch({ hands: hands(['S3 S9', 'S4 S10', 'S5 SJ', 'S6 SQ']), firstLeader: 0 });
    ok(mgr.act(room.code, members[0]!.playerId, { type: 'play', cardIds: [room.match.hand.hands[0]![0]!.id] }));
    vi.advanceTimersByTime(500);
    expect(room.match!.hand.trick).toHaveLength(2);
  });
});

describe('between hands', () => {
  function finishHand(room: Room, members: Member[]) {
    room.match = createMatch({ hands: hands(['S3', 'S4 S5', 'S6', 'S7 S8']), firstLeader: 0 });
    const id = (seat: number, i = 0) => room.match!.hand.hands[seat]![i]!.id;
    ok(mgr.act(room.code, members[0]!.playerId, { type: 'play', cardIds: [id(0)] }));
    for (const s of [1, 2, 3]) ok(mgr.act(room.code, members[s]!.playerId, { type: 'pass' }));
    ok(mgr.act(room.code, members[2]!.playerId, { type: 'play', cardIds: [id(2)] }));
    expect(room.match!.hand.phase).toBe('done');
  }

  it('deals the next hand once everyone confirms', () => {
    const { room, members } = startGame();
    finishHand(room, members);
    expect(mgr.viewFor(room, members[0]!.playerId).game!.lastResult?.levelGain).toBe(3);
    for (const m of members.slice(0, 3)) ok(mgr.nextHand(room.code, m.playerId));
    expect(room.match!.hand.number).toBe(1);
    expect(mgr.viewFor(room, members[0]!.playerId).game!.nextReady).toEqual([0, 1, 2]);
    ok(mgr.nextHand(room.code, members[3]!.playerId));
    expect(room.match!.hand.number).toBe(2);
    expect(room.match!.hand.phase).toBe('tribute');
  });

  it('deals the next hand automatically after the timeout', () => {
    const { room, members } = startGame();
    finishHand(room, members);
    vi.advanceTimersByTime(30_000);
    expect(room.match!.hand.number).toBe(2);
  });

  it('returns to the lobby for a new match once someone wins', () => {
    const { room, members } = startGame();
    expect(mgr.newMatch(room.code, members[0]!.playerId)).toMatchObject({ ok: false, error: 'wrong_phase' });
    room.match!.winner = 0;
    expect(mgr.newMatch(room.code, members[1]!.playerId)).toMatchObject({ ok: false, error: 'not_host' });
    ok(mgr.newMatch(room.code, members[0]!.playerId));
    expect(room.status).toBe('lobby');
    expect(room.match).toBeNull();
    expect(members[1]!.ready).toBe(false);
  });
});

describe('housekeeping', () => {
  it('sweeps rooms nobody is connected to', () => {
    const { room, members } = setupRoom(2);
    for (const m of members) mgr.disconnect(room.code, m.playerId, `sock${m.seat}`);
    vi.advanceTimersByTime(60_000);
    mgr.sweep(Date.now() + 16 * 60_000);
    expect(mgr.rooms.has(room.code)).toBe(false);
  });

  it('notifies on changes', () => {
    setupRoom(2);
    expect(changes).toBeGreaterThan(0);
  });
});
