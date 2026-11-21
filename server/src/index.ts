import { createApp } from './app';

const PORT = Number(process.env.PORT ?? 3001);
const origins = (process.env.CLIENT_ORIGIN ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// How long bots (and players on autopilot) "think" before moving.
const botDelay = Number(process.env.BOT_DELAY_MS);
// Pause after each deal so the dealing animation can finish before anyone acts.
const dealPause = Number(process.env.DEAL_PAUSE_MS);
const { httpServer, close } = createApp({
  origins,
  autoDelayMs: Number.isFinite(botDelay) && botDelay >= 0 ? botDelay : undefined,
  dealPauseMs: Number.isFinite(dealPause) && dealPause >= 0 ? dealPause : undefined,
});

httpServer.listen(PORT, () => {
  console.log(`[server] listening on :${PORT} (origins: ${origins.length ? origins.join(', ') : 'any'})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`[server] ${signal} received, shutting down`);
    void close().then(() => process.exit(0));
  });
}
