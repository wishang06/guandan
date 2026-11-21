import { createServer, type Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { GAME_NAME, type ClientToServerEvents, type ServerToClientEvents } from '@guandan/shared';
import { RoomManager, type RoomManagerOptions } from './rooms';
import { attachSocketHandlers } from './socket';

export interface AppOptions extends RoomManagerOptions {
  /** Allowed browser origins. Supports a leading wildcard host, e.g. https://*.vercel.app */
  origins?: string[];
}

/** Turn origin patterns into a CORS check. An empty list allows any origin. */
export function originMatcher(patterns: string[]) {
  const regexes = patterns.map(
    (p) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9-]+')}$`, 'i'),
  );
  return (origin: string | undefined) => !origin || regexes.length === 0 || regexes.some((r) => r.test(origin));
}

export function createApp(opts: AppOptions = {}): {
  httpServer: HttpServer;
  io: Server<ClientToServerEvents, ServerToClientEvents>;
  manager: RoomManager;
  close: () => Promise<void>;
} {
  const manager = new RoomManager(opts);
  const allowed = originMatcher(opts.origins ?? []);

  const httpServer = createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, name: GAME_NAME, rooms: manager.rooms.size }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: {
      origin: (origin, cb) => cb(null, allowed(origin)),
    },
    maxHttpBufferSize: 64 * 1024,
  });
  attachSocketHandlers(io, manager);

  const sweeper = setInterval(() => manager.sweep(), 60_000);
  sweeper.unref();

  const close = () =>
    new Promise<void>((resolve) => {
      clearInterval(sweeper);
      manager.dispose();
      io.close(() => resolve());
    });

  return { httpServer, io, manager, close };
}
