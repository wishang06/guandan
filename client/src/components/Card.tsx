import type { CSSProperties, HTMLAttributes } from 'react';
import { BIG_JOKER, SMALL_JOKER, SUIT_SYMBOL, isWild, rankLabel, type Card } from '@guandan/shared';
import { isRed } from '../lib/cards';
import { useI18n } from '../i18n';

interface CardFaceProps extends HTMLAttributes<HTMLDivElement> {
  card: Card;
  level: number;
  /** Card width in px. */
  width: number;
  selected?: boolean;
  dim?: boolean;
  /** Positioned by the parent (absolute) or in normal flow. */
  floating?: boolean;
}

export function CardFace({ card, level, width, selected, dim, floating = true, style, className, ...rest }: CardFaceProps) {
  const { t, lang } = useI18n();
  const joker = card.rank >= SMALL_JOKER;
  const wild = isWild(card, level);
  const levelCard = !joker && card.rank === level;
  const cls = [
    'card',
    floating ? '' : 'static',
    isRed(card) ? 'red' : '',
    joker ? 'joker' : '',
    selected ? 'selected' : '',
    dim ? 'dim' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  const label = joker
    ? card.rank === BIG_JOKER
      ? lang === 'zh' ? '大王' : 'big joker'
      : lang === 'zh' ? '小王' : 'small joker'
    : `${SUIT_SYMBOL[card.suit]}${rankLabel(card.rank)}${wild ? ` (${t('wild')})` : ''}`;
  return (
    <div
      className={cls}
      style={{ ['--cw' as string]: `${width}px`, ...style } as CSSProperties}
      data-card-id={card.id}
      aria-label={label}
      aria-pressed={selected}
      role="button"
      {...rest}
    >
      {joker ? (
        <>
          <span className="idx">JOKER</span>
          <span className="pip" style={{ fontSize: width * 0.42 }}>
            {card.rank === BIG_JOKER ? '★' : '☆'}
          </span>
        </>
      ) : (
        <>
          <span className={card.rank === 10 ? 'idx ten' : 'idx'}>
            <span>{rankLabel(card.rank)}</span>
            <span className="s">{SUIT_SYMBOL[card.suit]}</span>
          </span>
          <span className="pip">{SUIT_SYMBOL[card.suit]}</span>
          {wild ? <span className="wild">{t('wild')}</span> : levelCard ? <span className="lvl" /> : null}
        </>
      )}
    </div>
  );
}

export function CardBack({ width, style }: { width: number; style?: CSSProperties }) {
  return <div className="card static card-back" style={{ ['--cw' as string]: `${width}px`, ...style } as CSSProperties} />;
}
