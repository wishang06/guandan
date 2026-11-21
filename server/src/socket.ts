import type { Server, Socket } from 'socket.io';
import type { Ack, ClientToServerEvents, ServerToClientEvents, SessionInfo } from '@guandan/shared';
import type { Member, Room, RoomManager } from './rooms';
import { parseAction, parseCode, parseNickname, parseSeat, parseSettings, parseToken } from './validate';

type IO = Server<ClientToServerEvents, ServerToClientEvents>;
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type AckFn<T = undefined> = (r: Ack<T>) => void;

const noop = () => {};
const BAD: Ack<never> = { ok: false, error: 'bad_request' };

/** Send each member their own personalised view of the room. */
export function broadcastRoom(io: IO, manager: RoomManager, room: Room) {
  for (const m of room.members.values()) {
    if (m.socketId) io.to(m.socketId).emit('room:state', manager.viewFor(room, m.playerId));
  }
}

export function attachSocketHandlers(io: IO, manager: RoomManager) {
  manager.onChange = (room) => broadcastRoom(io, manager, room);

  io.on('connection', (socket: GameSocket) => {
    let current: { code: string; playerId: string } | null = null;

    const ackOf = <T>(ack: unknown): AckFn<T> => (typeof ack === 'function' ? (ack as AckFn<T>) : noop);

    /** Run a handler, turning thrown errors into a bad_request ack. */
    const guard = <T>(ack: unknown, fn: (reply: AckFn<T>) => void) => {
      const reply = ackOf<T>(ack);
      try {
        fn(reply);
      } catch (e) {
        console.error('[socket] handler error', e);
        reply(BAD);
      }
    };

    const bind = (room: Room, member: Member): SessionInfo => {
      if (current && (current.code !== room.code || current.playerId !== member.playerId)) {
        manager.disconnect(current.code, current.playerId, socket.id);
      }
      current = { code: room.code, playerId: member.playerId };
      const replaced = manager.connect(room, member, socket.id);
      if (replaced) io.to(replaced).emit('session:replaced');
      return { code: room.code, playerId: member.playerId, token: member.token };
    };

    socket.on('room:create', (p, ack) =>
      guard<SessionInfo>(ack, (reply) => {
        const nickname = parseNickname(p?.nickname);
        if (!nickname) return reply(BAD);
        const r = manager.create(nickname);
        if (!r.ok) return reply(r);
        reply({ ok: true, data: bind(r.data.room, r.data.member) });
      }),
    );

    socket.on('room:join', (p, ack) =>
      guard<SessionInfo>(ack, (reply) => {
        const nickname = parseNickname(p?.nickname);
        const code = parseCode(p?.code);
        if (!nickname || !code) return reply(BAD);
        const r = manager.join(code, nickname);
        if (!r.ok) return reply(r);
        reply({ ok: true, data: bind(r.data.room, r.data.member) });
      }),
    );

    socket.on('room:resume', (p, ack) =>
      guard<SessionInfo>(ack, (reply) => {
        const code = parseCode(p?.code);
        const token = parseToken(p?.token);
        if (!code || !token) return reply(BAD);
        const r = manager.resume(code, token);
        if (!r.ok) return reply(r);
        reply({ ok: true, data: bind(r.data.room, r.data.member) });
      }),
    );

    socket.on('room:leave', (ack) =>
      guard(ack, (reply) => {
        if (!current) return reply({ ok: false, error: 'not_in_room' });
        const r = manager.leave(current.code, current.playerId);
        current = null;
        reply(r);
      }),
    );

    socket.on('room:seat', (p, ack) =>
      guard(ack, (reply) => {
        const seat = parseSeat(p?.seat);
        if (!current) return reply({ ok: false, error: 'not_in_room' });
        if (seat === null) return reply(BAD);
        reply(manager.setSeat(current.code, current.playerId, seat));
      }),
    );

    socket.on('room:ready', (p, ack) =>
      guard(ack, (reply) => {
        if (!current) return reply({ ok: false, error: 'not_in_room' });
        if (typeof p?.ready !== 'boolean') return reply(BAD);
        reply(manager.setReady(current.code, current.playerId, p.ready));
      }),
    );

    socket.on('room:settings', (p, ack) =>
      guard(ack, (reply) => {
        if (!current) return reply({ ok: false, error: 'not_in_room' });
        const settings = parseSettings(p);
        if (!settings) return reply(BAD);
        reply(manager.updateSettings(current.code, current.playerId, settings));
      }),
    );

    socket.on('room:start', (ack) =>
      guard(ack, (reply) => {
        if (!current) return reply({ ok: false, error: 'not_in_room' });
        reply(manager.start(current.code, current.playerId));
      }),
    );

    socket.on('game:action', (p, ack) =>
      guard(ack, (reply) => {
        if (!current) return reply({ ok: false, error: 'not_in_room' });
        const action = parseAction(p);
        if (!action) return reply(BAD);
        reply(manager.act(current.code, current.playerId, action));
      }),
    );

    socket.on('game:next', (ack) =>
      guard(ack, (reply) => {
        if (!current) return reply({ ok: false, error: 'not_in_room' });
        reply(manager.nextHand(current.code, current.playerId));
      }),
    );

    socket.on('game:newMatch', (ack) =>
      guard(ack, (reply) => {
        if (!current) return reply({ ok: false, error: 'not_in_room' });
        reply(manager.newMatch(current.code, current.playerId));
      }),
    );

    socket.on('disconnect', () => {
      if (current) manager.disconnect(current.code, current.playerId, socket.id);
      current = null;
    });
  });
}
