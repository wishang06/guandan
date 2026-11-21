import type { CSSProperties } from 'react';
import type { SeatView } from '@guandan/shared';
import { useI18n, type MessageKey } from '../i18n';

interface SeatPlateProps {
  seat: SeatView;
  count: number;
  /** Partner of the viewer (same team). */
  ally: boolean;
  isTurn: boolean;
  /** Remaining fraction of the turn timer (0..1) when it's this seat's turn. */
  fraction: number | null;
  secondsLeft: number | null;
  place: number | null;
  align?: 'left' | 'right' | 'center';
}

const PLACE_KEYS: MessageKey[] = ['place1', 'place2', 'place3', 'place4'];

export function SeatPlate({ seat, count, ally, isTurn, fraction, secondsLeft, place, align = 'center' }: SeatPlateProps) {
  const { t, lang } = useI18n();
  const name = seat.nickname ?? t('emptySeat');
  const initial = [...name][0]?.toUpperCase() ?? '?';
  const team = ally ? 'var(--color-brass)' : 'var(--color-celadon)';
  const urgent = isTurn && secondsLeft !== null && secondsLeft <= 5;
  const status = !seat.occupied
    ? null
    : seat.isBot
      ? t('bot')
      : !seat.connected
        ? t('disconnected')
        : seat.autopilot
          ? t('autopilot')
          : null;
  const dir = align === 'right' ? 'flex-row-reverse text-right' : align === 'left' ? 'flex-row text-left' : 'flex-col text-center';
  const justify = align === 'right' ? 'flex-end' : align === 'left' ? 'flex-start' : 'center';
  const countClass = count <= 5 ? 'danger' : count <= 10 ? 'warn' : '';

  return (
    <div className={`flex items-center gap-1.5 ${dir}`} data-testid={`seat-${seat.seat}`} data-turn={isTurn || undefined}>
      <div className={`seat-avatar shrink-0 ${isTurn ? 'is-turn' : ''} ${urgent ? 'is-urgent' : ''}`} data-seat-anchor={seat.seat}>
        <div
          className={`relative size-11 rounded-full p-[3px] ${isTurn ? 'timer-ring' : ''}`}
          style={
            isTurn
              ? ({ ['--p' as string]: fraction ?? 1, ['--ring' as string]: urgent ? 'var(--color-cinnabar)' : 'var(--color-brass)' } as CSSProperties)
              : { background: team }
          }
        >
          <div className="grid size-full place-items-center rounded-full bg-lacquer text-lg font-semibold text-porcelain">{initial}</div>
        </div>
        {isTurn && secondsLeft !== null && (
          <span
            className={`absolute -bottom-1 -right-1 min-w-5 rounded-full px-1 text-center text-xs font-bold tabular-nums ${
              urgent ? 'bg-cinnabar text-porcelain' : 'bg-brass text-lacquer'
            }`}
          >
            {secondsLeft}
          </span>
        )}
      </div>
      <div className="min-w-0 leading-tight">
        <div className="flex items-baseline gap-1" style={{ justifyContent: justify }}>
          <span className="max-w-24 truncate text-sm font-semibold" title={name}>
            {name}
          </span>
          {isTurn && (
            <span className="thinking text-brass-soft" aria-label={t('thinking')}>
              <i />
              <i />
              <i />
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-1 text-xs text-porcelain/80" style={{ justifyContent: justify }}>
          {place ? (
            <span key={place} className={`seal-badge text-sm ${place === 1 ? 'first' : ''} ${lang === 'en' ? 'latin' : ''}`} data-place={place}>
              {t(PLACE_KEYS[place - 1]!)}
            </span>
          ) : (
            <span className={`count-chip inline-flex items-center gap-0.5 tabular-nums ${countClass}`} aria-label={t('cards', { n: count })}>
              <span className="card-back inline-block h-3 w-2 rounded-[2px] border" />
              {count}
            </span>
          )}
          {status && <span className="rounded bg-black/30 px-1">{status}</span>}
        </div>
      </div>
    </div>
  );
}
