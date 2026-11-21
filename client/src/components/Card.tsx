import type { CSSProperties, HTMLAttributes } from 'react';
import { ACE, BIG_JOKER, JACK, SMALL_JOKER, SUIT_SYMBOL, isWild, rankLabel, type Card } from '@guandan/shared';
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

function faceClass(card: Card, level: number): string {
  const joker = card.rank >= SMALL_JOKER;
  return [
    isRed(card) ? 'red' : '',
    joker ? 'joker' : '',
    card.rank === ACE ? 'ace' : '',
    !joker && card.rank >= JACK && card.rank < ACE ? 'court-card' : '',
    isWild(card, level) ? 'is-wild' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function CardFace({ card, level, width, selected, dim, floating = true, style, className, ...rest }: CardFaceProps) {
  const { t, lang } = useI18n();
  const joker = card.rank >= SMALL_JOKER;
  const wild = isWild(card, level);
  const levelCard = !joker && card.rank === level;
  const court = !joker && card.rank >= JACK && card.rank < ACE;
  const cls = ['card', floating ? '' : 'static', faceClass(card, level), selected ? 'selected' : '', dim ? 'dim' : '', className ?? '']
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
          <span className="wang">王</span>
        </>
      ) : (
        <>
          <span className={card.rank === 10 ? 'idx ten' : 'idx'}>
            <span>{rankLabel(card.rank)}</span>
            <span className="s">{SUIT_SYMBOL[card.suit]}</span>
          </span>
          {court && <span className="court">{rankLabel(card.rank)}</span>}
          <span className="pip">{SUIT_SYMBOL[card.suit]}</span>
          {wild ? (
            <>
              <span className="foil" />
              <span className="wild">配</span>
            </>
          ) : levelCard ? (
            <span className="lvl" />
          ) : null}
        </>
      )}
    </div>
  );
}

export function CardBack({ width, style }: { width: number; style?: CSSProperties }) {
  return <div className="card static card-back" style={{ ['--cw' as string]: `${width}px`, ...style } as CSSProperties} />;
}

/** The same card face as plain DOM, for effects that fly a card outside React. */
export function makeCardEl(card: Card, level: number, width: number): HTMLDivElement {
  const el = document.createElement('div');
  el.className = `card static ${faceClass(card, level)}`;
  el.style.setProperty('--cw', `${width}px`);
  const span = (cls: string, text = '') => {
    const s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    el.appendChild(s);
    return s;
  };
  if (card.rank >= SMALL_JOKER) {
    span('idx', 'JOKER');
    span('wang', '王');
    return el;
  }
  const idx = span(card.rank === 10 ? 'idx ten' : 'idx');
  const r = document.createElement('span');
  r.textContent = rankLabel(card.rank);
  const s = document.createElement('span');
  s.className = 's';
  s.textContent = SUIT_SYMBOL[card.suit];
  idx.append(r, s);
  if (card.rank >= JACK && card.rank < ACE) span('court', rankLabel(card.rank));
  span('pip', SUIT_SYMBOL[card.suit]);
  if (isWild(card, level)) span('wild', '配');
  else if (card.rank === level) span('lvl');
  return el;
}
