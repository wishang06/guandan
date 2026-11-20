import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { GAME_NAME } from '@guandan/shared';

const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_ORIGIN = (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const httpServer = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, name: GAME_NAME }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const io = new Server(httpServer, { cors: { origin: CLIENT_ORIGIN } });

io.on('connection', (socket) => {
  socket.emit('hello', { name: GAME_NAME });
});

httpServer.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`);
});
