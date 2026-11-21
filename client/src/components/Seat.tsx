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
  const { t } = useI18n();
  const name = seat.nickname ?? t('emptySeat');
  const initial = [...name][0]?.toUpperCase() ?? '?';
  const ring = isTurn
    ? undefined
    : ally
      ? 'var(--color-brass)'
      : 'var(--color-celadon)';
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

  return (
    <div className={`flex items-center gap-1.5 ${dir}`} data-testid={`seat-${seat.seat}`} data-turn={isTurn || undefined}>
      <div className="relative shrink-0">
        <div
          className={`size-11 rounded-full p-[3px] ${isTurn ? 'timer-ring' : ''}`}
          style={isTurn ? ({ ['--p' as string]: fraction ?? 1 } as CSSProperties) : { background: ring }}
        >
          <div className="size-full rounded-full bg-lacquer grid place-items-center text-lg font-semibold text-porcelain">
            {initial}
          </div>
        </div>
        {isTurn && secondsLeft !== null && (
          <span className="absolute -bottom-1 -right-1 min-w-5 rounded-full bg-brass px-1 text-center text-xs font-bold text-lacquer tabular-nums">
            {secondsLeft}
          </span>
        )}
      </div>
      <div className="min-w-0 leading-tight">
        <div className="max-w-24 truncate text-sm font-semibold" title={name}>
          {name}
        </div>
        <div className="flex items-center gap-1 text-xs text-porcelain/80" style={{ justifyContent: align === 'right' ? 'flex-end' : align === 'left' ? 'flex-start' : 'center' }}>
          {place ? (
            <span className="rounded bg-brass px-1 font-bold text-lacquer">{t(PLACE_KEYS[place - 1]!)}</span>
          ) : (
            <span className="inline-flex items-center gap-0.5 tabular-nums" aria-label={t('cards', { n: count })}>
              <span className="inline-block h-3 w-2 rounded-[2px] card-back border" />
              {count}
            </span>
          )}
          {status && <span className="rounded bg-black/30 px-1">{status}</span>}
        </div>
      </div>
    </div>
  );
}
