import { useState } from 'react';
import { rankLabel, type GameView, type RoomView, type Seat } from '@guandan/shared';
import { Button } from '../components/Chrome';
import { useI18n, type MessageKey } from '../i18n';
import { useGame } from '../state/game';

const PLACE_KEYS: MessageKey[] = ['place1', 'place2', 'place3', 'place4'];

export function HandResult({ view, game, serverNow }: { view: RoomView; game: GameView; serverNow: number }) {
  const { t } = useI18n();
  const ctx = useGame();
  const [busy, setBusy] = useState(false);
  const r = game.lastResult!;
  const me = (view.you.seat ?? 0) as Seat;
  const us = me % 2;
  const teamName = (team: number) => (team === us ? t('teamUs') : t('teamThem'));
  const nameOf = (s: Seat) => view.seats[s]?.nickname ?? `#${s + 1}`;
  const confirmed = game.nextReady.includes(me);
  const waiting = view.seats.filter(
    (s) => s.occupied && !s.isBot && !s.autopilot && s.connected && !game.nextReady.includes(s.seat),
  ).length;
  const secs = game.deadline ? Math.max(0, Math.ceil((game.deadline - serverNow) / 1000)) : null;

  const lines: string[] = [];
  for (const team of [0, 1]) {
    if (r.levelsAfter[team] !== r.levelsBefore[team]) {
      lines.push(
        t('levelChange', { team: teamName(team), from: rankLabel(r.levelsBefore[team]!), to: rankLabel(r.levelsAfter[team]!) }),
      );
    }
  }
  if (r.aFailed && r.aAttempt !== null) {
    lines.push(
      view.settings.aMaxFails > 0
        ? t('aFailed', { team: teamName(r.aAttempt), n: game.aFails[r.aAttempt] || view.settings.aMaxFails, max: view.settings.aMaxFails })
        : t('aFailedNoMax', { team: teamName(r.aAttempt) }),
    );
  }
  if (r.aReset && r.aAttempt !== null) lines.push(t('aReset', { team: teamName(r.aAttempt) }));
  if (lines.length === 0 && r.matchWinner === null) lines.push(t('noChange'));

  const next = async () => {
    setBusy(true);
    const res = await ctx.next();
    setBusy(false);
    if (!res.ok) ctx.toast(t(`err_${res.error}` as MessageKey), 'error');
  };
  const newMatch = async () => {
    setBusy(true);
    const res = await ctx.newMatch();
    setBusy(false);
    if (!res.ok) ctx.toast(t(`err_${res.error}` as MessageKey), 'error');
  };

  const won = r.matchWinner !== null;
  return (
    <div className="fixed inset-0 z-30 grid place-items-center overflow-y-auto bg-black/60 p-4" data-testid="hand-result">
      <div className="w-full max-w-sm rounded-2xl bg-lacquer p-5 shadow-2xl ring-1 ring-brass/30">
        {won ? (
          <h2 className="text-center font-[family-name:var(--font-card)] text-3xl font-black text-brass">
            {r.matchWinner === us ? t('weWon') : t('theyWon')}
          </h2>
        ) : (
          <h2 className="text-center text-xl font-semibold">{t('handOver', { n: r.handNumber })}</h2>
        )}

        <ol className="mt-4 space-y-1.5" aria-label={t('finishOrder')}>
          {r.finishOrder.map((s, i) => (
            <li
              key={s}
              className={`flex items-center gap-3 rounded-lg px-3 py-1.5 ${s % 2 === us ? 'bg-brass/15' : 'bg-celadon/10'}`}
            >
              <span className={`w-12 text-sm font-bold ${i === 0 ? 'text-brass' : 'text-porcelain/70'}`}>{t(PLACE_KEYS[i]!)}</span>
              <span className="flex-1 truncate font-semibold">
                {nameOf(s)}
                {s === me ? ` (${t('you')})` : ''}
              </span>
              <span className={`text-xs ${s % 2 === us ? 'text-brass-soft' : 'text-celadon'}`}>{teamName(s % 2)}</span>
            </li>
          ))}
        </ol>

        <div className="mt-4 space-y-1 text-center text-porcelain/90">
          {lines.map((l) => (
            <p key={l}>{l}</p>
          ))}
        </div>

        <div className="mt-5">
          {won ? (
            view.you.isHost ? (
              <Button tone="brass" className="w-full py-3 text-lg" disabled={busy} onClick={newMatch} data-testid="new-match">
                {t('newMatch')}
              </Button>
            ) : (
              <p className="text-center text-porcelain/70">{t('waitHostNew')}</p>
            )
          ) : (
            <>
              <Button
                tone="primary"
                className="w-full py-3 text-lg"
                disabled={busy || confirmed}
                onClick={next}
                data-testid="next-hand"
              >
                {confirmed ? t('waitingNext', { n: waiting }) : t('nextHand')}
              </Button>
              {secs !== null && <p className="mt-2 text-center text-sm text-porcelain/60">{t('nextIn', { s: secs })}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
