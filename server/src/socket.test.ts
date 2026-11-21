import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, RoomView, ServerToClientEvents, SessionInfo, Ack } from '@guandan/shared';
import { createApp } from './app';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

let app: ReturnType<typeof createApp>;
let url: string;
const clients: Client[] = [];

beforeAll(async () => {
  app = createApp({ autoDelayMs: 50 });
  await new Promise<void>((r) => app.httpServer.listen(0, r));
  url = `http://localhost:${(app.httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const c of clients) c.disconnect();
  await app.close();
});

function client(): Client {
  const c: Client = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  clients.push(c);
  return c;
}

/** Collects the latest room state pushed to a client. */
function track(c: Client) {
  const t = { latest: null as RoomView | null, count: 0 };
  c.on('room:state', (v) => {
    t.latest = v;
    t.count++;
  });
  return t;
}

async function until(pred: () => boolean, ms = 2000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

function data<T>(r: Ack<T>): T {
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

describe('socket server', () => {
  it('serves /health', async () => {
    const res = await fetch(`${url}/health`);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it('runs a room from lobby to the first plays, hiding other hands, and resumes a session', async () => {
    const cs = [client(), client(), client(), client()];
    const ts = cs.map(track);
    const host = data(await cs[0]!.emitWithAck('room:create', { nickname: 'Host' }));
    expect(host.code).toHaveLength(6);
    const sessions: SessionInfo[] = [host];
    for (let i = 1; i < 4; i++) {
      sessions.push(data(await cs[i]!.emitWithAck('room:join', { code: host.code.toLowerCase(), nickname: `P${i}` })));
      data(await cs[i]!.emitWithAck('room:ready', { ready: true }));
    }
    expect(await cs[1]!.emitWithAck('room:start')).toMatchObject({ ok: false, error: 'not_host' });
    data(await cs[0]!.emitWithAck('room:start'));
    await until(() => ts.every((t) => t.latest?.game?.myHand.length === 27));

    // Each client sees only its own 27 cards.
    const allIds = new Set(ts.flatMap((t) => t.latest!.game!.myHand.map((c) => c.id)));
    expect(allIds.size).toBe(108);

    // The player whose turn it is plays their lowest card; everyone sees it.
    const turn = ts[0]!.latest!.game!.turn!;
    const seatOf = (i: number) => ts[i]!.latest!.you.seat;
    const idx = [0, 1, 2, 3].find((i) => seatOf(i) === turn)!;
    const notTurn = (idx + 1) % 4;
    expect(await cs[notTurn]!.emitWithAck('game:action', { type: 'pass' })).toMatchObject({
      ok: false,
      error: 'not_your_turn',
    });
    expect(await cs[idx]!.emitWithAck('game:action', { type: 'play', cardIds: [9999] })).toMatchObject({
      ok: false,
      error: 'bad_request',
    });
    const card = ts[idx]!.latest!.game!.myHand[0]!;
    data(await cs[idx]!.emitWithAck('game:action', { type: 'play', cardIds: [card.id] }));
    await until(() => ts.every((t) => t.latest!.game!.lastPlay?.seat === turn));
    expect(ts[notTurn]!.latest!.game!.cardCounts[turn]).toBe(26);

    // Drop a client and come back with the session token on a new socket.
    const dropped = (idx + 2) % 4;
    const seat = seatOf(dropped);
    cs[dropped]!.disconnect();
    await until(() => ts[0]!.latest!.seats[seat!]!.connected === false || dropped === 0);
    const again = client();
    const tAgain = track(again);
    const resumed = data(
      await again.emitWithAck('room:resume', { code: host.code, token: sessions[dropped]!.token }),
    );
    expect(resumed.playerId).toBe(sessions[dropped]!.playerId);
    await until(() => tAgain.latest?.game !== undefined && tAgain.latest?.game !== null);
    expect(tAgain.latest!.you.seat).toBe(seat);
    expect(tAgain.latest!.game!.myHand.length).toBeGreaterThan(0);
    expect(await again.emitWithAck('room:resume', { code: host.code, token: '0'.repeat(32) })).toMatchObject({
      ok: false,
      error: 'invalid_session',
    });
  });

  it('rejects malformed payloads', async () => {
    const c = client();
    expect(await c.emitWithAck('room:create', { nickname: '   ' })).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await c.emitWithAck('room:join', { code: '!!', nickname: 'x' })).toMatchObject({
      ok: false,
      error: 'bad_request',
    });
    expect(await c.emitWithAck('room:join', { code: 'ABCDEF', nickname: 'x' })).toMatchObject({
      ok: false,
      error: 'room_not_found',
    });
    expect(await c.emitWithAck('room:start')).toMatchObject({ ok: false, error: 'not_in_room' });
  });
});

describe('origin checks', () => {
  it('refuses handshakes from origins not in CLIENT_ORIGIN, over polling and WebSocket', async () => {
    const strict = createApp({ origins: ['https://good.example'] });
    await new Promise<void>((r) => strict.httpServer.listen(0, r));
    const base = `http://localhost:${(strict.httpServer.address() as AddressInfo).port}`;
    const attempt = (origin: string, transports: ('websocket' | 'polling')[]) =>
      new Promise<boolean>((resolve) => {
        const c = connect(base, { transports, forceNew: true, reconnection: false, extraHeaders: { origin } });
        c.on('connect', () => {
          c.disconnect();
          resolve(true);
        });
        c.on('connect_error', () => {
          c.disconnect();
          resolve(false);
        });
      });
    try {
      expect(await attempt('https://good.example', ['websocket'])).toBe(true);
      expect(await attempt('https://evil.example', ['websocket'])).toBe(false);
      expect(await attempt('https://good.example', ['polling'])).toBe(true);
      expect(await attempt('https://evil.example', ['polling'])).toBe(false);
    } finally {
      await strict.close();
    }
  });
});
