import { createApp } from './app';

const PORT = Number(process.env.PORT ?? 3001);
const origins = (process.env.CLIENT_ORIGIN ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const { httpServer, close } = createApp({ origins });

httpServer.listen(PORT, () => {
  console.log(`[server] listening on :${PORT} (origins: ${origins.length ? origins.join(', ') : 'any'})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`[server] ${signal} received, shutting down`);
    void close().then(() => process.exit(0));
  });
}
