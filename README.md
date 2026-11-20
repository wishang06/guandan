# Guandan 掼蛋 — online multiplayer

A mobile-first web app for playing Guandan with friends (or bots).

| Package   | What it is                                                     |
| --------- | -------------------------------------------------------------- |
| `shared/` | Types and the pure rules engine, used by both server and client |
| `server/` | Node + TypeScript + Socket.IO authoritative game server          |
| `client/` | React + Vite + TypeScript + Tailwind front end                   |

## Quick start

```bash
npm install
npm run dev        # server on :3001, client on :5173 (proxied)
npm test           # Vitest unit tests
npm run typecheck  # tsc across all packages
```

Copy `.env.example` to `.env` if you need to change ports or origins.
