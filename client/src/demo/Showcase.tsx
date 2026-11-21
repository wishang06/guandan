import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyAction,
  botDecide,
  buildGameView,
  isBomb,
  pendingSeats,
  startNextHand,
  type Action,
  type MatchState,
  type RoomView,
  type Seat,
  type SeatView,
} from '@guandan/shared';
import { Button, Toasts } from '../components/Chrome';
import { cancelDirector } from '../fx/director';
import { useI18n } from '../i18n';
import { unlockAudio } from '../lib/sound';
import { Table } from '../screens/Table';
import { GameContext, type ClientAck, type GameContextValue, type Toast } from '../state/game';
import { SCENES, type Scene } from './scenes';

const OK: ClientAck = { ok: true, data: undefined };

/**
 * Effects preview: plays scripted moments on the real table, with no server. After a
 * scene's script ends the bots keep playing, so you can carry on with the hand.
 */
export function Showcase() {
  const { t, lang } = useI18n();
  const [match, setMatch] = useState<MatchState | null>(null);
  const [sceneId, setSceneId] = useState<string | null>(null);
  const [run, setRun] = useState(0);
  const [open, setOpen] = useState(true);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [scripted, setScripted] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const live = useRef<MatchState | null>(null);
  const timers = useRef<number[]>([]);
  const toastId = useRef(0);

  const commit = useCallback((m: MatchState) => {
    live.current = m;
    setMatch(m);
  }, []);

  const stop = useCallback(() => {
    timers.current.forEach((id) => clearTimeout(id));
    timers.current = [];
  }, []);

  const load = useCallback(
    (scene: Scene) => {
      unlockAudio();
      stop();
      cancelDirector();
      const setup = scene.build();
      commit(setup.match);
      setSceneId(scene.id);
      setRun((n) => n + 1);
      setOpen(false);
      setDeadline(setup.deadlineIn ? Date.now() + setup.deadlineIn : null);
      setScripted(setup.script.length > 0);
      let at = 0;
      setup.script.forEach((step, i) => {
        at += step.wait;
        timers.current.push(
          window.setTimeout(() => {
            if (live.current) commit(step.run(live.current));
            if (i === setup.script.length - 1) {
              setScripted(false);
              setDeadline(null);
            }
          }, at),
        );
      });
    },
    [commit, stop],
  );

  useEffect(() => stop, [stop]);

  // Once the script is over, bots answer your moves.
  useEffect(() => {
    if (!match || scripted || match.winner !== null || match.hand.phase === 'done') return;
    const seats = pendingSeats(match).filter((s) => s !== 0);
    if (seats.length === 0) return;
    // Like the server, wait for the deal to finish before anyone moves.
    const top = match.hand.lastPlay?.combo;
    const bombUp = top && isBomb(top) ? top.type : null;
    const justDealt = match.events.every((e) => e.kind === 'deal' || e.kind === 'antiTribute') && match.events.length > 0;
    const id = window.setTimeout(() => {
      if (!live.current) return;
      let m: MatchState = live.current;
      for (const s of pendingSeats(m).filter((x) => x !== 0)) {
        const action = botDecide(m, s);
        if (!action) continue;
        const r = applyAction(m, s, action);
        if (r.ok) m = r.state;
      }
      commit(m);
    }, justDealt ? 3400 : 900 + (bombUp ? (bombUp === 'jokerBomb' ? 2600 : 900) : 0));
    return () => clearTimeout(id);
  }, [match, scripted, commit]);

  const toast = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = ++toastId.current;
    setToasts((ts) => [...ts.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 3600);
  }, []);

  const exit = () => {
    window.location.href = window.location.pathname;
  };

  const view = useMemo<RoomView | null>(() => {
    if (!match) return null;
    const names = lang === 'zh' ? ['小林', '小梅', '阿波', '老凯'] : ['Lin', 'Mei', 'Bo', 'Kai'];
    const seats: SeatView[] = ([0, 1, 2, 3] as Seat[]).map((seat) => ({
      seat,
      occupied: true,
      playerId: `p${seat}`,
      nickname: names[seat]!,
      isBot: false,
      isHost: seat === 0,
      ready: true,
      connected: true,
      autopilot: false,
    }));
    return {
      code: 'DEMO',
      status: 'playing',
      hostId: 'p0',
      seats,
      settings: { turnSeconds: 30, aMaxFails: 3 },
      you: { playerId: 'p0', seat: 0, isHost: true },
      game: buildGameView(match, 0, { deadline, nextReady: [] }),
      serverTime: Date.now(),
    };
  }, [match, deadline, lang]);

  const value = useMemo<GameContextValue>(() => {
    const noop = async (): Promise<ClientAck> => OK;
    return {
      status: 'online',
      view,
      session: { code: 'DEMO', playerId: 'p0', token: '' },
      clockOffset: 0,
      replaced: false,
      toasts,
      toast,
      resume: () => {},
      createRoom: async () => ({ ok: false, error: 'bad_request' }),
      joinRoom: async () => ({ ok: false, error: 'bad_request' }),
      leave: async () => exit(),
      setSeat: noop,
      setReady: noop,
      addBot: noop,
      removeBot: noop,
      fillBots: noop,
      updateSettings: noop,
      start: noop,
      act: async (action: Action) => {
        const m = live.current;
        if (!m) return { ok: false, error: 'no_game' };
        const r = applyAction(m, 0, action);
        if (!r.ok) return r.options ? { ok: false, error: r.error, options: r.options } : { ok: false, error: r.error };
        commit(r.state);
        return OK;
      },
      next: async () => {
        const m = live.current;
        if (m && m.hand.phase === 'done' && m.winner === null) commit(startNextHand(m));
        return OK;
      },
      newMatch: async () => {
        setOpen(true);
        return OK;
      },
    };
  }, [view, toasts, toast, commit]);

  return (
    <GameContext.Provider value={value}>
      <Toasts />
      {view ? (
        <Table key={run} view={view} />
      ) : (
        <main className="felt grid h-dvh place-items-center">
          <p className="font-[family-name:var(--font-brush)] text-7xl text-porcelain/10">掼蛋</p>
        </main>
      )}

      {!open && (
        <button
          type="button"
          className="fixed left-2 top-12 z-[48] rounded-full bg-lacquer/90 px-3 py-1.5 text-sm font-semibold text-brass-soft shadow-lg ring-1 ring-brass/40"
          onClick={() => setOpen(true)}
          data-testid="scenes-open"
        >
          {t('scenes')}
        </button>
      )}

      {open && (
        <div className="backdrop-in fixed inset-0 z-[49] flex items-end justify-center bg-black/60 sm:items-center" onClick={() => match && setOpen(false)}>
          <div
            className="sheet-in max-h-[86dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-lacquer p-4 sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={t('showcaseTitle')}
          >
            <div className="flex items-baseline justify-between gap-3">
              <h1 className="font-[family-name:var(--font-card)] text-2xl font-black text-brass">{t('showcaseTitle')}</h1>
              <button type="button" className="text-sm text-porcelain/60 underline" onClick={exit} data-testid="showcase-exit">
                {t('showcaseExit')}
              </button>
            </div>
            <p className="mt-1 text-sm text-porcelain/65">{t('showcaseHint')}</p>
            <ul className="mt-3 grid gap-1.5">
              {SCENES.map((scene) => (
                <li key={scene.id}>
                  <Button
                    tone={scene.id === sceneId ? 'brass' : 'plain'}
                    className="w-full px-3 py-2.5 text-left text-base"
                    onClick={() => load(scene)}
                    data-scene={scene.id}
                  >
                    {lang === 'zh' ? scene.zh : scene.en}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </GameContext.Provider>
  );
}
