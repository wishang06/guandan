import { useEffect, useState, type CSSProperties } from 'react';
import { rankLabel, type GameView, type RoomView, type Seat } from '@guandan/shared';
import { Button } from '../components/Chrome';
import { fxFull } from '../fx/settings';
import { useI18n, type MessageKey } from '../i18n';
import { playSound } from '../lib/sound';
import { useGame } from '../state/game';

const PLACE_KEYS: MessageKey[] = ['place1', 'place2', 'place3', 'place4'];

/** Counts a level up one rank at a time (2 → 3 → 4 → 5), with a plucked note per step. */
function LevelRoll({ from, to, delay }: { from: number; to: number; delay: number }) {
  const [shown, setShown] = useState(fxFull() ? from : to);
  useEffect(() => {
    if (shown === to) return;
    const step = to > from ? 1 : -1;
    const id = setTimeout(
      () => {
        setShown((v) => v + step);
        playSound('level', { step: Math.abs(shown + step - from) });
      },
      shown === from ? delay : 260,
    );
    return () => clearTimeout(id);
  }, [shown, from, to, delay]);
  return (
    <span key={shown} className="flip-in inline-block min-w-6 font-[family-name:var(--font-card)] text-2xl font-black text-brass lining-nums">
      {rankLabel(shown)}
    </span>
  );
}

export function HandResult({ view, game, serverNow }: { view: RoomView; game: GameView; serverNow: number }) {
  const { t, lang } = useI18n();
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
  const won = r.winningTeam === us;
  const matchOver = r.matchWinner !== null;

  const notes: string[] = [];
  if (r.aFailed && r.aAttempt !== null) {
    notes.push(
      view.settings.aMaxFails > 0
        ? t('aFailed', { team: teamName(r.aAttempt), n: game.aFails[r.aAttempt] || view.settings.aMaxFails, max: view.settings.aMaxFails })
        : t('aFailedNoMax', { team: teamName(r.aAttempt) }),
    );
  }
  if (r.aReset && r.aAttempt !== null) notes.push(t('aReset', { team: teamName(r.aAttempt) }));
  const changed = ([0, 1] as const).filter((team) => r.levelsAfter[team] !== r.levelsBefore[team]);
  if (changed.length === 0 && notes.length === 0 && !matchOver) notes.push(t('noChange'));

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

  // The verdict is a brushed character in Chinese, a serif word in English.
  const verdict = matchOver ? (r.matchWinner === us ? t('weWon') : t('theyWon')) : won ? t('verdictWin') : t('verdictLose');
  const glyph = matchOver ? (r.matchWinner === us ? '胜利' : '惜败') : won ? '胜' : '败';

  return (
    <div className="backdrop-in fixed inset-0 z-30 grid place-items-center overflow-y-auto bg-black/60 p-4" data-testid="hand-result">
      {/* One column on a tall screen; on a phone held sideways the order goes beside the verdict. */}
      <div className="sheet-in w-full max-w-sm rounded-2xl bg-lacquer p-5 shadow-2xl ring-1 ring-brass/30 short:grid short:max-w-2xl short:grid-cols-2 short:items-center short:gap-x-6 short:p-4">
        <div className="flex items-center justify-center gap-3 short:col-start-1 short:row-start-1">
          <span
            className={`verdict shrink-0 whitespace-nowrap ${glyph.length > 1 ? 'text-5xl' : 'text-6xl'} ${won ? 'text-brass' : 'text-porcelain/55'}`}
            aria-hidden={lang === 'en'}
          >
            {glyph}
          </span>
          <div className="text-left leading-tight">
            <h2 className={`font-[family-name:var(--font-card)] text-2xl font-black ${won ? 'text-brass' : 'text-porcelain/80'}`}>{verdict}</h2>
            <p className="text-sm text-porcelain/60">{t('handOver', { n: r.handNumber })}</p>
          </div>
        </div>

        <ol className="mt-4 space-y-1.5 short:col-start-2 short:row-span-3 short:row-start-1 short:mt-0" aria-label={t('finishOrder')}>
          {r.finishOrder.map((s, i) => (
            <li
              key={s}
              className={`reveal flex items-center gap-3 rounded-lg px-3 py-1.5 ${s % 2 === us ? 'bg-brass/15' : 'bg-celadon/10'}`}
              style={{ ['--i' as string]: i } as CSSProperties}
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

        <div className="reveal-late mt-4 space-y-1 text-center text-porcelain/90 short:col-start-1 short:row-start-2 short:mt-2">
          {changed.map((team) => (
            <p key={team} className="flex items-center justify-center gap-2" data-testid="level-change">
              <span>{teamName(team)}</span>
              <span className="font-[family-name:var(--font-card)] text-xl font-bold text-porcelain/60 lining-nums">{rankLabel(r.levelsBefore[team]!)}</span>
              <span aria-hidden="true" className="text-porcelain/50">
                ▸
              </span>
              <LevelRoll from={r.levelsBefore[team]!} to={r.levelsAfter[team]!} delay={1500} />
              <span className="sr-only">{rankLabel(r.levelsAfter[team]!)}</span>
            </p>
          ))}
          {notes.map((l) => (
            <p key={l}>{l}</p>
          ))}
        </div>

        <div className="mt-5 short:col-start-1 short:row-start-3 short:mt-3">
          {matchOver ? (
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
                className="w-full py-3 text-lg short:py-2"
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
