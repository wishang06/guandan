# Client ↔ server protocol

Socket.IO with typed events (see [`shared/src/protocol.ts`](../shared/src/protocol.ts)).
The server is authoritative: clients only send **intents**; every one is validated
(`server/src/validate.ts`) and then checked by the shared rules engine.

## Client → server (all acknowledged with `{ ok: true, data } | { ok: false, error }`)

| Event            | Payload                         | Notes                                              |
| ---------------- | ------------------------------- | -------------------------------------------------- |
| `room:create`    | `{ nickname }`                  | Returns `{ code, playerId, token }`; you get seat 0 |
| `room:join`      | `{ code, nickname }`            | Takes the first free seat (or replaces a bot)      |
| `room:resume`    | `{ code, token }`               | Reclaims your seat after a reconnect               |
| `room:leave`     | –                               | Lobby: frees the seat. In game: autopilot takes over |
| `room:seat`      | `{ seat }`                      | Lobby only, to a free seat                         |
| `room:ready`     | `{ ready }`                     | Lobby only                                         |
| `room:settings`  | `{ turnSeconds?, aMaxFails? }`  | Host only                                          |
| `room:addBot`    | `{ seat }`                      | Host only, lobby, empty seat                       |
| `room:removeBot` | `{ seat }`                      | Host only, lobby                                   |
| `room:fillBots`  | –                               | Host only: a bot in every empty seat               |
| `room:start`     | –                               | Host only; 4 seated, everyone else ready           |
| `game:action`    | `Action`                        | `play` / `pass` / `tribute` / `return`             |
| `game:next`      | –                               | Confirm the end-of-hand screen                     |
| `game:newMatch`  | –                               | Host only, after a match is won                    |

A `play` that is ambiguous (wild cards) fails with `error: 'ambiguous'` and
`options: Combo[]`; resend it with `choice: { type, rank, size }`.

## Server → client

* `room:state` — a personalised `RoomView` after every change. It contains **your**
  hand only; other seats are card counts. Return cards (还贡) are only visible to the
  two players involved; tribute cards become public once all are chosen.
* `session:replaced` — the same session was opened on another socket.

## Sessions and reconnecting

The `token` from create/join is a secret kept in `localStorage`. After a disconnect
the seat is held for **2 minutes** (`RECONNECT_GRACE_MS`): in the lobby the player is
then removed; during a game the seat goes on autopilot (timeouts play for it) until
the player resumes.

## Timers

`turnSeconds` (default 30, 0 = off). On expiry the server plays the default action
(`timeoutAction`): pass when following, lowest single when leading, highest card for
tribute, lowest ≤10 card for the return. Bots and players on autopilot are played by
`botDecide` (`shared/src/bot.ts`) after ~1 s (`BOT_DELAY_MS` overrides it). The
end-of-hand screen deals the next hand when every connected player confirms, or after
30 s.
