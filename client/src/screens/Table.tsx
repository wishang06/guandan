import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  getLegalInterpretations,
  isBomb,
  rankLabel,
  returnCandidates,
  sameKey,
  suggestPlays,
  tributeCandidates,
  type Combo,
  type GameView,
  type RoomView,
  type Seat,
} from '@guandan/shared';
import { Button, LangToggle, SoundToggle } from '../components/Chrome';
import { CardRow } from '../components/CardRow';
import { Hand } from '../components/Hand';
import { SeatPlate } from '../components/Seat';
import { useI18n, type MessageKey } from '../i18n';
import { cardText, describeCombo, displayCards } from '../lib/cards';
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

  // ---------- selection ----------
  const [selected, setSelected] = useState<Set<number>>(new Set());
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
    () => (myTurn ? suggestPlays(game.myHand, level, current) : []),
    [myTurn, game.myHand, level, current],
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
  };

  const report = (error: string) => ctx.toast(t(`err_${error}` as MessageKey), 'error');

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

  // ---------- sounds & announcements ----------
  const lastSeq = useRef<number | null>(null);
  useEffect(() => {
    const events = game.events;
    const prev = lastSeq.current;
    lastSeq.current = events.at(-1)?.seq ?? prev;
    if (prev === null) return; // don't replay history on first render
    for (const e of events) {
      if (e.seq <= prev) continue;
      switch (e.kind) {
        case 'play':
          playSound(e.combo && isBomb(e.combo) ? 'bomb' : 'play');
          break;
        case 'pass':
          playSound('pass');
          break;
        case 'finish':
          playSound('finish');
          break;
        case 'deal':
          playSound('deal');
          break;
        case 'matchEnd':
          playSound('win');
          break;
        case 'jiefeng':
          if (e.seat !== undefined) ctx.toast(t('jiefeng', { name: nameOf(e.seat) }));
          break;
        case 'antiTribute':
          if (e.seat !== undefined) ctx.toast(t('antiTribute', { name: nameOf(e.seat) }));
          break;
        case 'tribute':
          if (e.seat !== undefined && e.to !== undefined && e.card)
            ctx.toast(t('tributeGave', { from: nameOf(e.seat), to: nameOf(e.to), card: cardText(e.card, lang) }));
          break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.events]);

  const wasMyTurn = useRef(false);
  useEffect(() => {
    if (myTurn && !wasMyTurn.current) playSound('turn');
    wasMyTurn.current = myTurn;
  }, [myTurn]);
  const lastTick = useRef<number | null>(null);
  useEffect(() => {
    if (!myTurn || secondsLeft === null || secondsLeft > 5 || secondsLeft === lastTick.current) return;
    lastTick.current = secondsLeft;
    if (secondsLeft > 0) playSound('tick');
  }, [myTurn, secondsLeft]);

  // ---------- layout ----------
  const trickW = clamp(Math.min(vp.w, vp.h) * (vp.portrait ? 0.075 : 0.085), 24, 44);
  const seatAt = (pos: 0 | 1 | 2 | 3) => ((me + pos) % 4) as Seat;
  const entryFor = (s: Seat) => {
    for (let i = game.trick.length - 1; i >= 0; i--) if (game.trick[i]!.seat === s) return game.trick[i]!;
    return null;
  };
  const placeOf = (s: Seat) => {
    const i = game.finishOrder.indexOf(s);
    return i >= 0 ? i + 1 : null;
  };

  const trickSlot = (s: Seat, align: 'start' | 'center' | 'end') => {
    const e = entryFor(s);
    const isTop = game.lastPlay?.seat === s && e?.combo;
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
            <CardRow cards={displayCards(e.combo)} level={level} width={trickW} highlight={!!isTop} />
            {isTop && <span className="mt-0.5 text-xs text-brass-soft">{describeCombo(e.combo, level, t)}</span>}
          </>
        ) : e ? (
          <span className="rounded-full bg-black/30 px-3 py-0.5 text-sm text-porcelain/80">{t('passed')}</span>
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

  const actionArea = tributeMode ? (
    <div className="flex w-full max-w-lg items-center gap-2 rounded-xl bg-lacquer/95 px-3 py-2 ring-1 ring-brass/40" data-testid="tribute-panel">
      <p className="flex-1 text-sm leading-tight">
        {tributeMode === 'give'
          ? t('tributeGive', {
              name: (tribute!.kind === 'single' ? [tribute!.receivers[0]!] : tribute!.receivers).map(nameOf).join(' / '),
            })
          : t('tributeReturn', { name: nameOf(myReturn!.from) })}
      </p>
      <Button tone="brass" disabled={busy || selected.size !== 1} onClick={giveOrReturn} data-testid="tribute-confirm">
        {tributeMode === 'give' ? t('tributeGiveBtn') : t('tributeReturnBtn')}
      </Button>
    </div>
  ) : game.phase === 'play' && !placeOf(me) ? (
    <>
      <Button tone="plain" disabled={!myTurn || busy} onClick={hint} data-testid="hint" data-has-hint={suggestions.length > 0}>
        {t('hint')}
      </Button>
      <Button tone="plain" disabled={!myTurn || busy || !current} onClick={pass} data-testid="pass">
        {t('pass')}
      </Button>
      <Button tone="primary" className="min-w-24" disabled={!myTurn || busy || selected.size === 0} onClick={play} data-testid="play">
        {t('play')}
      </Button>
    </>
  ) : null;

  return (
    <main className="felt flex h-dvh flex-col overflow-hidden" data-testid="table" data-seq={game.events.at(-1)?.seq ?? 0}>
      <TopBar view={view} game={game} />

      <section className="relative grid min-h-0 flex-1 grid-cols-[minmax(0,auto)_1fr_minmax(0,auto)] grid-rows-[auto_1fr_auto] gap-x-1 px-2 pt-1">
        <div className="col-start-1 row-span-3 row-start-1 flex flex-col justify-center gap-2 pl-0.5">
          {plate(seatAt(3), 'left')}
          {trickSlot(seatAt(3), 'start')}
        </div>
        <div className={`col-start-2 row-start-1 flex items-center gap-1 ${vp.portrait ? 'flex-col' : 'flex-row justify-center gap-4'}`}>
          {plate(seatAt(2), vp.portrait ? 'center' : 'left')}
          {trickSlot(seatAt(2), vp.portrait ? 'center' : 'start')}
        </div>
        <div className="col-start-3 row-span-3 row-start-1 flex flex-col items-end justify-center gap-2 pr-0.5">
          {plate(seatAt(1), 'right')}
          {trickSlot(seatAt(1), 'end')}
        </div>
        <div className="col-start-2 row-start-2 flex flex-col items-center justify-center text-center">
          <p
            className={`text-lg font-semibold ${myTurn ? 'text-brass' : 'text-porcelain/75'}`}
            data-testid={myTurn ? 'your-turn' : 'status'}
          >
            {statusText}
            {myTurn && secondsLeft !== null && <span className="ml-2 tabular-nums text-porcelain">{secondsLeft}</span>}
          </p>
          {placeOf(me) && <p className="text-sm text-porcelain/70">{t('out')}</p>}
        </div>
        <div className="col-start-2 row-start-3 flex justify-center pb-1">{trickSlot(me, 'center')}</div>
        {!vp.portrait && !tributeMode && actionArea && (
          <div className="absolute bottom-1 right-2 flex flex-col items-end gap-1">
            {preview && <span className="max-w-64 truncate text-sm text-porcelain/75">{preview}</span>}
            <div className="flex gap-2">{actionArea}</div>
          </div>
        )}
      </section>

      {/* Action area: its own row in portrait, floating bottom-right of the table in landscape */}
      {(tributeMode || vp.portrait) && actionArea && (
        <section className="flex min-h-12 items-center justify-center gap-2 px-3 py-1">{actionArea}</section>
      )}
      {vp.portrait && preview && !tributeMode && game.phase === 'play' && (
        <p className="-mt-1 truncate px-3 text-center text-xs text-porcelain/70">{preview}</p>
      )}

      <section className="lacquer px-2 pb-[max(env(safe-area-inset-bottom),6px)] pt-1">
        <Hand
          cards={game.myHand}
          level={level}
          selected={selected}
          onSelect={onSelect}
          eligible={eligible}
          single={!!tributeMode}
          disabled={game.phase === 'done' || (game.phase !== 'play' && !tributeMode)}
        />
      </section>

      {choices && (
        <ChoiceSheet
          options={choices}
          level={level}
          onPick={(c) => void send(c)}
          onCancel={() => setChoices(null)}
        />
      )}
      {game.phase === 'done' && game.lastResult && <HandResult view={view} game={game} serverNow={serverNow} />}
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
      <span className="font-[family-name:var(--font-card)] text-lg font-black leading-none lining-nums">{rankLabel(game.levels[team]!)}</span>
    </div>
  );
  return (
    <header className="lacquer flex items-center gap-2 px-2 py-1 pt-[max(env(safe-area-inset-top),4px)]">
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
      <span className="text-xs text-porcelain/60">{view.code}</span>
      <div className="flex-1" />
      {team(us, t('teamUs'))}
      {team(them, t('teamThem'))}
      <div className="flex items-center gap-1 rounded-md bg-porcelain px-1.5 py-0.5 text-ink" title={t('levelCard')} data-testid="level-card">
        <span className="text-[11px] leading-none">{t('levelCard')}</span>
        <span className="font-[family-name:var(--font-card)] text-lg font-black leading-none text-suit-red lining-nums">{rankLabel(game.level)}</span>
      </div>
      <div className="flex-1" />
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
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 sm:items-center" onClick={onCancel}>
      <div
        className="w-full max-w-sm rounded-t-2xl bg-lacquer p-4 sm:rounded-2xl"
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
