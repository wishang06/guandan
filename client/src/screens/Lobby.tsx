import { useState, type ReactNode } from 'react';
import { TURN_SECONDS_OPTIONS, type RoomView, type Seat, type SeatView } from '@guandan/shared';
import { Button, LangToggle, SoundToggle } from '../components/Chrome';
import { useI18n, type MessageKey } from '../i18n';
import { unlockAudio } from '../lib/sound';
import { useGame, type ClientAck } from '../state/game';

const A_RESET_OPTIONS = [0, 1, 2, 3, 5] as const;

/** Where a seat sits on screen relative to the viewer: 0 bottom, 1 right, 2 top, 3 left. */
export const relativePos = (seat: Seat, me: Seat | null) => ((seat - (me ?? 0) + 4) % 4) as 0 | 1 | 2 | 3;

export function Lobby({ view }: { view: RoomView }) {
  const { t } = useI18n();
  const game = useGame();
  const [busy, setBusy] = useState(false);
  const me = view.you.seat;
  const mySeat = me !== null ? view.seats[me]! : null;
  const isHost = view.you.isHost;
  const filled = view.seats.filter((s) => s.occupied).length;
  const othersReady = view.seats.every((s) => !s.occupied || s.isHost || s.ready);

  const run = async (fn: () => Promise<ClientAck>) => {
    unlockAudio();
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (!r.ok) game.toast(t(`err_${r.error}` as MessageKey), 'error');
  };

  const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${view.code}`;
  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Guandan 掼蛋', text: `${t('room')} ${view.code}`, url: inviteUrl });
        return;
      }
      await navigator.clipboard.writeText(inviteUrl);
      game.toast(t('copied'));
    } catch {
      // user cancelled the share sheet
    }
  };

  const status = filled < 4 ? t('waitingPlayers', { n: 4 - filled }) : !othersReady ? t('waitingReady') : isHost ? '' : t('waitingHost');

  const seatTile = (s: SeatView) => {
    const pos = relativePos(s.seat, me);
    const ally = me !== null && s.seat % 2 === me % 2;
    const place = ['col-start-2 row-start-3', 'col-start-3 row-start-2', 'col-start-2 row-start-1', 'col-start-1 row-start-2'][pos];
    const mine = s.seat === me;
    const base = `${place} flex min-h-20 flex-col items-center justify-center rounded-xl px-2 py-2 text-center`;
    if (!s.occupied) {
      return (
        <div
          key={s.seat}
          className={`${base} gap-1.5 border-2 border-dashed border-porcelain/25 text-porcelain/70`}
          data-testid={`lobby-seat-${s.seat}`}
        >
          <span className="text-sm">{t('emptySeat')}</span>
          <div className="flex flex-wrap justify-center gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => game.setSeat(s.seat))}
              className="rounded-full bg-porcelain/10 px-2.5 py-1 text-xs font-semibold text-porcelain hover:bg-porcelain/20"
            >
              {t('sitHere')}
            </button>
            {isHost && (
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => game.addBot(s.seat))}
                className="rounded-full bg-brass/90 px-2.5 py-1 text-xs font-semibold text-lacquer hover:bg-brass"
                data-testid={`add-bot-${s.seat}`}
              >
                {t('addBot')}
              </button>
            )}
          </div>
        </div>
      );
    }
    return (
      <div
        key={s.seat}
        className={`${base} bg-lacquer/90 ring-2 ${ally ? 'ring-brass' : 'ring-celadon/70'}`}
        data-testid={`lobby-seat-${s.seat}`}
      >
        <span className="max-w-full truncate text-lg font-semibold">
          {s.nickname}
          {mine ? ` (${t('you')})` : ''}
        </span>
        <span className="mt-0.5 flex flex-wrap justify-center gap-1 text-xs">
          {s.isHost && <span className="rounded bg-brass px-1 font-semibold text-lacquer">{t('host')}</span>}
          {s.isBot && <span className="rounded bg-black/30 px-1">{t('bot')}</span>}
          {!s.isHost && !s.isBot && (
            <span className={s.ready ? 'text-brass-soft' : 'text-porcelain/50'}>{s.ready ? t('ready') : t('notReady')}</span>
          )}
          {!s.connected && <span className="text-porcelain/50">{t('disconnected')}</span>}
        </span>
        {s.isBot && isHost && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => game.removeBot(s.seat))}
            className="mt-1 text-xs text-porcelain/60 underline hover:text-porcelain"
          >
            {t('removeBot')}
          </button>
        )}
      </div>
    );
  };

  return (
    <main className="felt min-h-dvh px-4 pb-8 pt-3">
      <header className="mx-auto flex max-w-md items-center gap-2">
        <Button tone="ghost" className="px-2" onClick={() => void game.leave()} data-testid="leave">
          {t('leave')}
        </Button>
        <div className="flex-1" />
        <LangToggle />
        <SoundToggle />
      </header>

      <section className="mx-auto mt-4 max-w-md text-center">
        <p className="text-sm text-porcelain/70">{t('roomCode')}</p>
        <p className="font-[family-name:var(--font-card)] text-5xl font-black tracking-[0.18em] text-brass lining-nums" data-testid="room-code">
          {view.code}
        </p>
        <Button tone="plain" className="mt-3" onClick={share}>
          {t('shareLink')}
        </Button>
      </section>

      <section className="mx-auto mt-6 max-w-md">
        <div className="grid grid-cols-3 grid-rows-3 gap-2">
          {view.seats.map(seatTile)}
          <div className="col-start-2 row-start-2 grid place-items-center rounded-full bg-felt-deep/60 text-center text-xs text-porcelain/60 ring-1 ring-felt-line">
            <span className="px-2">{t('partnersHint')}</span>
          </div>
        </div>
      </section>

      {isHost && (
        <section className="mx-auto mt-6 max-w-md rounded-xl bg-lacquer/80 p-4">
          <h2 className="text-base font-semibold text-porcelain">{t('settings')}</h2>
          <p className="mt-3 text-sm text-porcelain/70">{t('turnTimer')}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {TURN_SECONDS_OPTIONS.map((n) => (
              <Chip key={n} on={view.settings.turnSeconds === n} onClick={() => run(() => game.updateSettings({ turnSeconds: n }))}>
                {n === 0 ? t('timerOff') : t('seconds', { n })}
              </Chip>
            ))}
          </div>
          <p className="mt-3 text-sm text-porcelain/70">{t('aResets')}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {A_RESET_OPTIONS.map((n) => (
              <Chip key={n} on={view.settings.aMaxFails === n} onClick={() => run(() => game.updateSettings({ aMaxFails: n }))}>
                {n === 0 ? t('never') : String(n)}
              </Chip>
            ))}
          </div>
        </section>
      )}

      <section className="mx-auto mt-6 max-w-md text-center">
        {status && <p className="mb-3 text-porcelain/75">{status}</p>}
        {isHost && filled < 4 && (
          <div className="mb-3">
            <p className="mb-2 text-sm text-porcelain/60">{t('soloHint')}</p>
            <Button tone="brass" className="w-full" disabled={busy} onClick={() => run(game.fillBots)} data-testid="fill-bots">
              {t('fillBots')}
            </Button>
          </div>
        )}
        {isHost ? (
          <Button
            tone="primary"
            className="w-full py-3 text-lg"
            disabled={busy || filled < 4 || !othersReady}
            onClick={() => run(game.start)}
            data-testid="start"
          >
            {t('start')}
          </Button>
        ) : (
          mySeat && (
            <Button
              tone={mySeat.ready ? 'plain' : 'brass'}
              className="w-full py-3 text-lg"
              disabled={busy}
              onClick={() => run(() => game.setReady(!mySeat.ready))}
              data-testid="ready"
            >
              {mySeat.ready ? t('cancelReady') : t('imReady')}
            </Button>
          )
        )}
      </section>
    </main>
  );
}

function Chip({ on, children, onClick }: { on: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-full px-3 py-1 text-sm font-semibold ${on ? 'bg-brass text-lacquer' : 'bg-black/30 text-porcelain/80 hover:bg-black/45'}`}
    >
      {children}
    </button>
  );
}
