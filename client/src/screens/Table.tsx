import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  SEATS,
  getLegalInterpretations,
  isBomb,
  rankLabel,
  returnCandidates,
  sameKey,
  smartSuggestions,
  tributeCandidates,
  type Combo,
  type GameView,
  type RoomView,
  type Seat,
} from '@guandan/shared';
import { Button, FxToggle, LangToggle, SoundToggle } from '../components/Chrome';
import { TrickPlay } from '../components/CardRow';
import { Hand } from '../components/Hand';
import { SeatPlate } from '../components/Seat';
import { cardsLeftAlert, retainDirector, runEvents } from '../fx/director';
import { setDimLayer } from '../fx/dom';
import { FxBackCanvas } from '../fx/FxStage';
import { isFresh, markSeen, primeClock, seatPoint } from '../fx/flight';
import { buzz } from '../fx/haptics';
import { tierOf } from '../fx/plan';
import { fxFull } from '../fx/settings';
import { setShakeTarget } from '../fx/shake';
import { useI18n, type MessageKey } from '../i18n';
import { cardText, describeCombo } from '../lib/cards';
import { playSound, unlockAudio } from '../lib/sound';
import { clamp, useViewport } from '../lib/useViewport';
import { useGame, useNow } from '../state/game';
import { HandResult } from './HandResult';

export function Table({ view }: { view: RoomView }) {
  const game = view.game!;
  const { t, lang } = useI18n();
  const ctx = useGame();
  const vp = useViewport();
  const now = useNow(250);
  const me = (view.you.seat ?? 0) as Seat;
  const myTeam = me % 2;
  const level = game.level;
  const current = game.lastPlay?.combo ?? null;
  const myTurn = game.phase === 'play' && game.turn === me;
  const nameOf = (s: Seat) => view.seats[s]?.nickname ?? `#${s + 1}`;

  // Decide which history is "already seen" before any child animates.
  useState(() => primeClock(game.events));

  const mainRef = useRef<HTMLElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const spotRef = useRef<HTMLDivElement>(null);
  const dimRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setShakeTarget(mainRef.current);
    setDimLayer(dimRef.current);
    const release = retainDirector();
    return () => {
      setShakeTarget(null);
      setDimLayer(null);
      release();
    };
  }, []);

  // ---------- selection ----------
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [wave, setWave] = useState<Map<number, number> | undefined>();
  const [choices, setChoices] = useState<Combo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const handIds = useMemo(() => new Set(game.myHand.map((c) => c.id)), [game.myHand]);
  useEffect(() => {
    setSelected((sel) => {
      const next = new Set([...sel].filter((id) => handIds.has(id)));
      return next.size === sel.size ? sel : next;
    });
  }, [handIds]);

  // ---------- tribute ----------
  const tribute = game.tribute;
  const myPayment = tribute?.payments.find((p) => p.from === me && !p.paid);
  const myReturn = tribute?.payments.find((p) => p.to === me && !p.returned);
  const tributeMode = game.phase === 'tribute' && myPayment ? 'give' : game.phase === 'return' && myReturn ? 'return' : null;
  const eligible = useMemo(() => {
    if (tributeMode === 'give') return new Set(tributeCandidates(game.myHand, level).map((c) => c.id));
    if (tributeMode === 'return') return new Set(returnCandidates(game.myHand, level).map((c) => c.id));
    return null;
  }, [tributeMode, game.myHand, level]);
  useEffect(() => {
    if (tributeMode) setSelected(new Set());
  }, [tributeMode]);

  const onSelect = (ids: number[], on: boolean) => {
    setWave(undefined);
    if (tributeMode) {
      setSelected(new Set(on ? ids.slice(-1) : []));
      return;
    }
    setSelected((sel) => {
      const next = new Set(sel);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  // ---------- legality & hints ----------
  const selectedCards = useMemo(() => game.myHand.filter((c) => selected.has(c.id)), [game.myHand, selected]);
  const legal = useMemo(
    () => (selectedCards.length ? getLegalInterpretations(selectedCards, level, current) : []),
    [selectedCards, level, current],
  );
  const anyReading = useMemo(
    () => (selectedCards.length && legal.length === 0 ? getLegalInterpretations(selectedCards, level, null) : legal),
    [selectedCards, legal, level],
  );
  const suggestions = useMemo(
    () =>
      myTurn
        ? smartSuggestions({ seat: me, hand: game.myHand, level, lastPlay: game.lastPlay, cardCounts: game.cardCounts })
        : [],
    [myTurn, me, game.myHand, level, game.lastPlay, game.cardCounts],
  );
  const hintIdx = useRef(0);
  const hinted = useRef<Combo | null>(null);
  useEffect(() => {
    hintIdx.current = 0;
  }, [suggestions]);

  const hint = () => {
    unlockAudio();
    if (suggestions.length === 0) {
      ctx.toast(t('noHint'));
      return;
    }
    const s = suggestions[hintIdx.current % suggestions.length]!;
    hintIdx.current += 1;
    hinted.current = s;
    setSelected(new Set(s.cards.map((c) => c.id)));
    setWave(new Map(s.cards.map((c, i) => [c.id, i])));
    playSound('select');
    buzz(8);
  };

  const report = (error: string) => {
    ctx.toast(t(`err_${error}` as MessageKey), 'error');
    buzz([30, 40, 30]);
  };

  const send = async (combo: Combo) => {
    setBusy(true);
    const r = await ctx.act({ type: 'play', cardIds: [...selected], choice: { type: combo.type, rank: combo.rank, size: combo.size } });
    setBusy(false);
    setChoices(null);
    if (r.ok) {
      setSelected(new Set());
      hinted.current = null;
    } else report(r.error);
  };

  const play = () => {
    unlockAudio();
    if (legal.length === 0) {
      ctx.toast(anyReading.length ? t('doesNotBeat') : t('invalidSelection'), 'error');
      buzz([30, 40, 30]);
      return;
    }
    const h = hinted.current;
    const sameCards =
      h && h.cards.length === selected.size && h.cards.every((c) => selected.has(c.id)) && legal.some((l) => sameKey(l, h));
    if (sameCards) return void send(legal.find((l) => sameKey(l, h!))!);
    if (legal.length === 1) return void send(legal[0]!);
    setChoices(legal);
  };

  const pass = async () => {
    unlockAudio();
    setBusy(true);
    const r = await ctx.act({ type: 'pass' });
    setBusy(false);
    if (r.ok) setSelected(new Set());
    else report(r.error);
  };

  const giveOrReturn = async () => {
    const id = [...selected][0];
    if (id === undefined || !tributeMode) return;
    setBusy(true);
    const r = await ctx.act({ type: tributeMode === 'give' ? 'tribute' : 'return', cardId: id });
    setBusy(false);
    if (r.ok) setSelected(new Set());
    else report(r.error);
  };

  // ---------- timer ----------
  const serverNow = now + ctx.clockOffset;
  const remainingMs = game.deadline ? Math.max(0, game.deadline - serverNow) : null;
  const turnMs = view.settings.turnSeconds * 1000;
  const fraction = remainingMs !== null && turnMs > 0 ? clamp(remainingMs / turnMs, 0, 1) : null;
  const secondsLeft = remainingMs !== null ? Math.ceil(remainingMs / 1000) : null;
  const urgent = myTurn && secondsLeft !== null && secondsLeft <= 5 && secondsLeft > 0;

  // ---------- staging: turn new game events into effects ----------
  const events = game.events;
  const lastPlayEvent = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) if (events[i]!.kind === 'play') return events[i]!;
    return null;
  }, [events]);
  const dealSeq = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) if (events[i]!.kind === 'deal') return events[i]!.seq;
    return undefined;
  }, [events]);

  const sawHandEnd = useRef(false);
  useEffect(() => {
    const fresh = events.filter((e) => isFresh(e.seq));
    if (fresh.length === 0) return;
    markSeen(fresh[fresh.length - 1]!.seq);
    runEvents(fresh, { me, level, lang, t, nameOf, result: game.lastResult });
    for (const e of fresh) {
      if (e.kind === 'handEnd') sawHandEnd.current = true;
      if (e.kind === 'antiTribute' && e.seat !== undefined) ctx.toast(t('antiTribute', { name: nameOf(e.seat) }));
      if (e.kind === 'tribute' && e.seat !== undefined && e.to !== undefined && e.card) {
        ctx.toast(t('tributeGave', { from: nameOf(e.seat), to: nameOf(e.to), card: cardText(e.card, lang) }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  // Low-card alerts: a seat dropping to ten, then five.
  const prevCounts = useRef(game.cardCounts);
  useEffect(() => {
    const prev = prevCounts.current;
    prevCounts.current = game.cardCounts;
    if (game.phase !== 'play') return;
    for (const s of SEATS) {
      const a = prev[s];
      const b = game.cardCounts[s];
      if (b > 0 && ((a > 10 && b <= 10) || (a > 5 && b <= 5))) cardsLeftAlert(s, b, { t });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.cardCounts]);

  // Hold the result screen back until the last play has landed and been stamped.
  const [resultHand, setResultHand] = useState<number | null>(game.phase === 'done' ? game.handNumber : null);
  useEffect(() => {
    if (game.phase !== 'done') {
      setResultHand(null);
      return;
    }
    const live = sawHandEnd.current && fxFull();
    sawHandEnd.current = false;
    const tier = lastPlayEvent?.combo ? tierOf(lastPlayEvent.combo) : 0;
    const wait = live ? 1700 + (tier >= 5 ? 1500 : tier >= 2 ? 500 : 0) + (game.lastResult?.partnerPlace === 2 ? 700 : 0) : 0;
    const id = setTimeout(() => setResultHand(game.handNumber), wait);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.phase, game.handNumber]);

  // Turn cues.
  const wasMyTurn = useRef(false);
  const turnKey = useRef(0);
  const countedTurn = useRef(false);
  if (myTurn && !countedTurn.current) turnKey.current += 1;
  countedTurn.current = myTurn;
  useEffect(() => {
    if (myTurn && !wasMyTurn.current) {
      playSound('turn');
      buzz([14, 60, 14]);
    }
    wasMyTurn.current = myTurn;
  }, [myTurn]);
  const lastTick = useRef<number | null>(null);
  useEffect(() => {
    if (!myTurn || secondsLeft === null || secondsLeft > 5 || secondsLeft === lastTick.current) return;
    lastTick.current = secondsLeft;
    if (secondsLeft > 0) {
      playSound('tick');
      buzz(12);
    }
  }, [myTurn, secondsLeft]);

  // The pool of light follows whoever is to act.
  useLayoutEffect(() => {
    const spot = spotRef.current;
    const section = sectionRef.current;
    if (!spot || !section) return;
    const r = section.getBoundingClientRect();
    const turn = game.phase === 'play' ? game.turn : null;
    const p = turn === null ? null : turn === me ? { x: r.left + r.width / 2, y: r.bottom - 24 } : seatPoint(turn);
    if (!p) {
      spot.style.opacity = '0';
      return;
    }
    spot.style.opacity = '1';
    spot.style.transform = `translate3d(${p.x - r.left}px, ${p.y - r.top}px, 0)`;
  }, [game.turn, game.phase, me, vp.w, vp.h]);

  // ---------- layout ----------
  const trickW = clamp(Math.min(vp.w, vp.h) * (vp.portrait ? 0.075 : 0.085), 24, 44);
  const seatAt = (pos: 0 | 1 | 2 | 3) => ((me + pos) % 4) as Seat;
  const finalPlay = game.phase === 'done' && game.trick.length === 0 ? lastPlayEvent : null;
  const entryFor = (s: Seat): { combo: Combo | null; index: number } | null => {
    for (let i = game.trick.length - 1; i >= 0; i--) if (game.trick[i]!.seat === s) return { combo: game.trick[i]!.combo, index: i };
    if (finalPlay && finalPlay.seat === s && finalPlay.combo) return { combo: finalPlay.combo, index: 0 };
    return null;
  };
  const playSeq = (s: Seat): number => {
    for (let i = events.length - 1; i >= 0; i--) if (events[i]!.kind === 'play' && events[i]!.seat === s) return events[i]!.seq;
    return 0;
  };
  const topSeat = game.lastPlay?.seat ?? finalPlay?.seat ?? null;
  const placeOf = (s: Seat) => {
    const i = game.finishOrder.indexOf(s);
    return i >= 0 ? i + 1 : null;
  };

  const trickSlot = (s: Seat, align: 'start' | 'center' | 'end') => {
    const e = entryFor(s);
    const isTop = topSeat === s && !!e?.combo;
    const seq = e?.combo ? playSeq(s) : 0;
    return (
      <div
        className={`flex min-h-[calc(var(--tw)*1.4)] flex-col justify-center ${
          align === 'start' ? 'items-start' : align === 'end' ? 'items-end' : 'items-center'
        }`}
        style={{ ['--tw' as string]: `${trickW}px` } as CSSProperties}
        data-testid={`trick-${s}`}
      >
        {e?.combo ? (
          <>
            <TrickPlay key={`${s}-${seq}`} combo={e.combo} seat={s} seq={seq} level={level} width={trickW} highlight={isTop} mine={s === me} />
            {isTop && <span className="mt-0.5 text-xs text-brass-soft">{describeCombo(e.combo, level, t)}</span>}
          </>
        ) : e ? (
          <span key={`pass-${e.index}`} className="pass-pill rounded-full bg-black/35 px-3 py-0.5 text-sm text-porcelain/85">
            {t('passed')}
          </span>
        ) : null}
      </div>
    );
  };

  const plate = (s: Seat, align: 'left' | 'right' | 'center') => (
    <SeatPlate
      seat={view.seats[s]!}
      count={game.cardCounts[s]}
      ally={s % 2 === myTeam}
      isTurn={game.phase === 'play' && game.turn === s}
      fraction={fraction}
      secondsLeft={secondsLeft}
      place={placeOf(s)}
      align={align}
    />
  );

  const statusText =
    game.phase === 'tribute'
      ? t('tributeWaiting')
      : game.phase === 'return'
        ? t('returnWaiting')
        : game.phase === 'play'
          ? myTurn
            ? current
              ? t('yourTurn')
              : t('yourLead')
            : t('waitingFor', { name: nameOf(game.turn ?? 0) })
          : '';

  const preview =
    selectedCards.length === 0
      ? null
      : legal.length
        ? legal.map((l) => describeCombo(l, level, t)).join(' / ')
        : anyReading.length
          ? t('doesNotBeat')
          : t('invalidSelection');

  const armed = myTurn && !busy && legal.length > 0;
  const actionArea = tributeMode ? (
    <div className="rise-in flex w-full max-w-lg items-center gap-2 rounded-xl bg-lacquer/95 px-3 py-2 ring-1 ring-brass/40" data-testid="tribute-panel">
      <p className="flex-1 text-sm leading-tight">
        {tributeMode === 'give'
          ? t('tributeGive', {
              name: (tribute!.kind === 'single' ? [tribute!.receivers[0]!] : tribute!.receivers).map(nameOf).join(' / '),
            })
          : t('tributeReturn', { name: nameOf(myReturn!.from) })}
      </p>
      <Button tone="brass" className={selected.size === 1 && !busy ? 'armed' : ''} disabled={busy || selected.size !== 1} onClick={giveOrReturn} data-testid="tribute-confirm">
        {tributeMode === 'give' ? t('tributeGiveBtn') : t('tributeReturnBtn')}
      </Button>
    </div>
  ) : game.phase === 'play' && !placeOf(me) ? (
    <div key={myTurn ? `turn-${turnKey.current}` : 'wait'} className={`flex gap-2 ${myTurn ? 'rise-in' : ''}`}>
      <Button tone="plain" disabled={!myTurn || busy} onClick={hint} data-testid="hint" data-has-hint={suggestions.length > 0}>
        {t('hint')}
      </Button>
      <Button tone="plain" disabled={!myTurn || busy || !current} onClick={pass} data-testid="pass">
        {t('pass')}
      </Button>
      <Button
        tone="primary"
        className={`min-w-24 ${armed ? 'armed' : ''}`}
        disabled={!myTurn || busy || selected.size === 0}
        onClick={play}
        data-testid="play"
      >
        {t('play')}
      </Button>
    </div>
  ) : null;

  return (
    <main
      ref={mainRef}
      className="felt flex h-dvh flex-col overflow-hidden"
      data-testid="table"
      data-seq={events[events.length - 1]?.seq ?? 0}
    >
      <FxBackCanvas />
      <div ref={dimRef} className="table-dim" />
      <TopBar view={view} game={game} />

      <section
        ref={sectionRef}
        className="relative z-[2] grid min-h-0 flex-1 grid-cols-[minmax(0,auto)_1fr_minmax(0,auto)] grid-rows-[auto_1fr_auto] gap-x-1 px-3 pt-2"
      >
        <div className="table-rim" />
        <div className="table-mark" aria-hidden="true">
          掼
        </div>
        <div ref={spotRef} className="spotlight" style={{ opacity: 0 }} />
        <span data-fx-center className="pointer-events-none absolute left-1/2 top-[46%] size-0" />
        {/* Your own seat has no plate; effects aimed at you land at the bottom edge. */}
        <span data-seat-anchor={me} className="pointer-events-none absolute bottom-3 left-1/2 size-0" />

        <div className="relative col-start-1 row-span-3 row-start-1 flex flex-col justify-center gap-2 pl-0.5">
          {plate(seatAt(3), 'left')}
          {trickSlot(seatAt(3), 'start')}
        </div>
        <div className={`relative col-start-2 row-start-1 flex items-center gap-1 ${vp.portrait ? 'flex-col' : 'flex-row justify-center gap-4'}`}>
          {plate(seatAt(2), vp.portrait ? 'center' : 'left')}
          {trickSlot(seatAt(2), vp.portrait ? 'center' : 'start')}
        </div>
        <div className="relative col-start-3 row-span-3 row-start-1 flex flex-col items-end justify-center gap-2 pr-0.5">
          {plate(seatAt(1), 'right')}
          {trickSlot(seatAt(1), 'end')}
        </div>
        <div className="relative col-start-2 row-start-2 flex flex-col items-center justify-center text-center">
          <p
            key={myTurn ? `mine-${turnKey.current}` : 'other'}
            className={`text-lg font-semibold ${myTurn ? 'turn-pop text-brass' : 'text-porcelain/75'} ${urgent ? '!text-[#ff9d86]' : ''}`}
            data-testid={myTurn ? 'your-turn' : 'status'}
          >
            {statusText}
            {myTurn && secondsLeft !== null && <span className="ml-2 tabular-nums text-porcelain">{secondsLeft}</span>}
          </p>
          {placeOf(me) && game.phase === 'play' && (
            <p className="mt-1 flex items-center gap-2 text-sm text-porcelain/70">
              <span className={`seal-badge text-base ${placeOf(me) === 1 ? 'first' : ''} ${lang === 'en' ? 'latin' : ''}`}>
                {t(`place${placeOf(me)}` as MessageKey)}
              </span>
              {t('out')}
            </p>
          )}
        </div>
        <div className="relative col-start-2 row-start-3 flex justify-center pb-1">{trickSlot(me, 'center')}</div>
        {!vp.portrait && !tributeMode && actionArea && (
          <div className="absolute bottom-1 right-2 z-[3] flex flex-col items-end gap-1">
            {preview && <span className="max-w-64 truncate text-sm text-porcelain/75">{preview}</span>}
            {actionArea}
          </div>
        )}
      </section>

      {/* Action area: its own row in portrait, floating bottom-right of the table in landscape */}
      {(tributeMode || vp.portrait) && actionArea && (
        <section className="relative z-[3] flex min-h-12 items-center justify-center gap-2 px-3 py-1">{actionArea}</section>
      )}
      {vp.portrait && preview && !tributeMode && game.phase === 'play' && (
        <p className="relative z-[3] -mt-1 truncate px-3 text-center text-xs text-porcelain/70">{preview}</p>
      )}

      <section className={`lacquer tray relative z-[1] px-2 pb-[max(env(safe-area-inset-bottom),6px)] pt-1 ${myTurn || tributeMode ? 'my-turn' : ''}`}>
        {myTurn && fraction !== null && (
          <div className={`tray-timer ${urgent ? 'urgent' : ''}`} style={{ transform: `scaleX(${fraction})` }} data-testid="my-timer" />
        )}
        <Hand
          cards={game.myHand}
          level={level}
          selected={selected}
          onSelect={onSelect}
          eligible={eligible}
          single={!!tributeMode}
          disabled={game.phase === 'done' || (game.phase !== 'play' && !tributeMode)}
          dealSeq={dealSeq}
          arrivalFrom={() => {
            // A tribute or return card is flown across the table to our edge by the
            // director; the hand picks it up from there.
            const e = events[events.length - 1];
            return e && (e.kind === 'tribute' || e.kind === 'return') && e.to === me ? seatPoint(me) : null;
          }}
          wave={wave}
        />
      </section>

      {urgent && <div className="urgency" aria-hidden="true" />}

      {choices && (
        <ChoiceSheet
          options={choices}
          level={level}
          onPick={(c) => void send(c)}
          onCancel={() => setChoices(null)}
        />
      )}
      {game.phase === 'done' && game.lastResult && resultHand === game.handNumber && (
        <HandResult view={view} game={game} serverNow={serverNow} />
      )}
    </main>
  );
}

function TopBar({ view, game }: { view: RoomView; game: GameView }) {
  const { t } = useI18n();
  const ctx = useGame();
  const me = view.you.seat ?? 0;
  const us = me % 2;
  const them = 1 - us;
  const team = (team: number, label: string) => (
    <div
      className={`flex items-baseline gap-1 rounded-md px-1.5 py-0.5 ${team === us ? 'text-brass-soft' : 'text-celadon'} ${
        game.declarer === team ? 'bg-black/30 ring-1 ring-current' : ''
      }`}
      title={game.declarer === team ? t('declaring') : undefined}
    >
      <span className="text-xs">{label}</span>
      <span key={game.levels[team]} className="flip-in font-[family-name:var(--font-card)] text-lg font-black leading-none lining-nums">
        {rankLabel(game.levels[team]!)}
      </span>
    </div>
  );
  return (
    <header className="lacquer relative z-[5] flex items-center gap-1.5 px-2 py-1 pt-[max(env(safe-area-inset-top),4px)]">
      <button
        type="button"
        className="rounded px-1.5 text-sm text-porcelain/60 hover:text-porcelain"
        onClick={() => {
          if (window.confirm(t('leave') + '?')) void ctx.leave();
        }}
        aria-label={t('leave')}
      >
        ✕
      </button>
      <span className="hidden text-xs text-porcelain/60 min-[400px]:inline">{view.code}</span>
      <div className="flex-1" />
      {team(us, t('teamUs'))}
      {team(them, t('teamThem'))}
      <div className="flex items-center gap-1 rounded-md bg-porcelain px-1.5 py-0.5 text-ink" title={t('levelCard')} data-testid="level-card">
        <span className="text-[11px] leading-none">{t('levelCard')}</span>
        <span key={game.level} className="flip-in font-[family-name:var(--font-card)] text-lg font-black leading-none text-suit-red lining-nums">
          {rankLabel(game.level)}
        </span>
      </div>
      <div className="flex-1" />
      <FxToggle />
      <LangToggle />
      <SoundToggle />
    </header>
  );
}

function ChoiceSheet({
  options,
  level,
  onPick,
  onCancel,
}: {
  options: Combo[];
  level: number;
  onPick: (c: Combo) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="backdrop-in fixed inset-0 z-40 flex items-end justify-center bg-black/50 sm:items-center" onClick={onCancel}>
      <div
        className="sheet-in w-full max-w-sm rounded-t-2xl bg-lacquer p-4 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={t('chooseCombo')}
        data-testid="choice-sheet"
      >
        <p className="mb-3 text-center font-semibold">{t('chooseCombo')}</p>
        <div className="flex flex-col gap-2">
          {options.map((o) => (
            <Button key={`${o.type}-${o.rank}`} tone={isBomb(o) ? 'primary' : 'brass'} className="py-3" onClick={() => onPick(o)}>
              {describeCombo(o, level, t)}
            </Button>
          ))}
          <Button tone="ghost" onClick={onCancel}>
            {t('cancel')}
          </Button>
        </div>
      </div>
    </div>
  );
}
