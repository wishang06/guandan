import { useEffect, useState, type ButtonHTMLAttributes } from 'react';
import { useI18n } from '../i18n';
import { setFxLevel, useFxLevel } from '../fx/settings';
import { isMuted, onMutedChange, setMuted, unlockAudio } from '../lib/sound';
import { useGame } from '../state/game';

export function LangToggle() {
  const { lang, setLang, t } = useI18n();
  return (
    <button
      type="button"
      className="h-8 min-w-10 rounded-md bg-black/25 px-2 text-sm font-semibold hover:bg-black/40"
      onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
      aria-label={lang === 'zh' ? 'Switch to English' : '切换到中文'}
      data-testid="lang-toggle"
    >
      {t('language')}
    </button>
  );
}

export function SoundToggle() {
  const { t } = useI18n();
  const [muted, setM] = useState(isMuted());
  useEffect(() => {
    const off = onMutedChange(setM);
    return () => void off();
  }, []);
  return (
    <button
      type="button"
      className="grid h-8 w-9 place-items-center rounded-md bg-black/25 hover:bg-black/40"
      onClick={() => {
        unlockAudio();
        setMuted(!muted);
      }}
      aria-label={t('sound')}
      aria-pressed={!muted}
      data-testid="sound-toggle"
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none" />
        {muted ? <path d="M17 9l4 6M21 9l-4 6" /> : <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />}
      </svg>
    </button>
  );
}

/** Full effects ↔ reduced motion (no shake, flashes or particles). */
export function FxToggle() {
  const { t } = useI18n();
  const level = useFxLevel();
  const full = level === 'full';
  return (
    <button
      type="button"
      className={`grid h-8 w-9 place-items-center rounded-md hover:bg-black/40 ${full ? 'bg-black/25 text-brass-soft' : 'bg-black/25 text-porcelain/45'}`}
      onClick={() => setFxLevel(full ? 'reduced' : 'full')}
      aria-label={t('effects')}
      aria-pressed={full}
      title={full ? t('effectsFull') : t('effectsReduced')}
      data-testid="fx-toggle"
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden="true">
        <path d="M12 2l1.8 5.6L19.5 9l-5.7 1.4L12 16l-1.8-5.6L4.5 9l5.7-1.4L12 2z" />
        <path d="M18.5 14l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6z" opacity={full ? 1 : 0.4} />
        {!full && <path d="M4 20L20 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
      </svg>
    </button>
  );
}

export function Toasts() {
  const { toasts } = useGame();
  return (
    <div className="pointer-events-none fixed inset-x-0 top-12 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast-in max-w-sm rounded-lg px-3 py-2 text-center text-sm shadow-lg ${
            t.tone === 'error' ? 'bg-cinnabar text-porcelain' : 'bg-lacquer text-porcelain ring-1 ring-brass/40'
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function ConnectionBanner() {
  const { status, replaced, resume } = useGame();
  const { t } = useI18n();
  // Free hosting tiers sleep when idle; after a few seconds explain the wait.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (status === 'online') {
      setSlow(false);
      return;
    }
    const id = setTimeout(() => setSlow(true), 5000);
    return () => clearTimeout(id);
  }, [status]);
  if (replaced) {
    return (
      <div className="fixed inset-0 z-[60] grid place-items-center bg-black/70 p-6 text-center">
        <div className="max-w-xs rounded-xl bg-lacquer p-5">
          <p className="mb-4">{t('sessionReplaced')}</p>
          <button type="button" className="rounded-lg bg-brass px-4 py-2 font-semibold text-lacquer" onClick={resume}>
            OK
          </button>
        </div>
      </div>
    );
  }
  if (status === 'online') return null;
  return (
    <div className="fixed inset-x-0 top-0 z-50 bg-cinnabar py-1 text-center text-sm" role="status">
      {slow ? t('wakingUp') : status === 'connecting' ? t('connecting') : t('reconnecting')}
    </div>
  );
}

export function Button({
  tone = 'plain',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'primary' | 'brass' | 'plain' | 'ghost' }) {
  const tones = {
    primary: 'bg-cinnabar text-porcelain hover:bg-cinnabar-deep disabled:bg-cinnabar/40 disabled:text-porcelain/50',
    brass: 'bg-brass text-lacquer hover:bg-brass-soft disabled:bg-brass/40',
    plain: 'bg-porcelain/10 text-porcelain hover:bg-porcelain/20 disabled:opacity-40',
    ghost: 'bg-transparent text-porcelain/80 hover:text-porcelain hover:bg-black/20',
  };
  return (
    <button
      type="button"
      className={`rounded-lg px-4 py-2 font-semibold transition-colors ${tones[tone]} ${className}`}
      {...rest}
    />
  );
}
