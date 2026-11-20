import { useState, type FormEvent } from 'react';
import { ROOM_CODE_LENGTH } from '@guandan/shared';
import { Button, LangToggle, SoundToggle } from '../components/Chrome';
import { useI18n, type MessageKey } from '../i18n';
import { unlockAudio } from '../lib/sound';
import { KEYS, load, save } from '../lib/storage';
import { useGame } from '../state/game';

export function Home() {
  const { t } = useI18n();
  const game = useGame();
  const [nickname, setNickname] = useState(() => load<string>(KEYS.nickname, ''));
  const [code, setCode] = useState(() => new URLSearchParams(window.location.search).get('room')?.toUpperCase() ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invited = code.length === ROOM_CODE_LENGTH;

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    unlockAudio();
    if (!nickname.trim()) {
      setError(t('nickname'));
      return;
    }
    save(KEYS.nickname, nickname.trim());
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) setError(t(`err_${r.error}` as MessageKey));
  };

  const create = (e?: FormEvent) => {
    e?.preventDefault();
    void run(() => game.createRoom(nickname.trim()));
  };
  const join = (e?: FormEvent) => {
    e?.preventDefault();
    void run(() => game.joinRoom(code.trim().toUpperCase(), nickname.trim()));
  };

  return (
    <main className="felt min-h-dvh px-4 pb-10 pt-3">
      <div className="mx-auto flex max-w-sm justify-end gap-2">
        <LangToggle />
        <SoundToggle />
      </div>
      <div className="mx-auto mt-[8vh] max-w-sm">
        <h1 className="text-center leading-none">
          <span className="block font-[family-name:var(--font-card)] text-7xl font-black tracking-tight text-porcelain">
            掼蛋
          </span>
          <span className="mt-2 block font-[family-name:var(--font-card)] text-2xl font-bold italic text-brass">
            Guandan
          </span>
        </h1>
        <p className="mt-4 text-center text-lg text-porcelain/80">{t('tagline')}</p>

        <form onSubmit={invited ? join : create} className="mt-10 rounded-2xl bg-lacquer/90 p-5 shadow-2xl ring-1 ring-brass/20">
          <label className="block text-sm text-porcelain/70" htmlFor="nickname">
            {t('nickname')}
          </label>
          <input
            id="nickname"
            data-testid="nickname"
            className="mt-1 w-full rounded-lg border border-porcelain/15 bg-black/30 px-3 py-2.5 text-lg text-porcelain placeholder:text-porcelain/35 focus:border-brass focus:outline-none"
            placeholder={t('nicknamePlaceholder')}
            value={nickname}
            maxLength={16}
            autoComplete="nickname"
            onChange={(e) => setNickname(e.target.value)}
          />

          {!invited && (
            <Button tone="primary" className="mt-4 w-full py-3 text-lg" disabled={busy} type="submit" data-testid="create-room">
              {t('createRoom')}
            </Button>
          )}

          <div className={invited ? 'mt-4' : 'mt-6 border-t border-porcelain/10 pt-4'}>
            <label className="block text-sm text-porcelain/70" htmlFor="code">
              {invited ? t('roomCode') : t('orJoin')}
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id="code"
                data-testid="room-code-input"
                className="min-w-0 flex-1 rounded-lg border border-porcelain/15 bg-black/30 px-3 py-2.5 text-lg uppercase tracking-[0.3em] text-porcelain placeholder:tracking-normal placeholder:text-porcelain/35 focus:border-brass focus:outline-none"
                placeholder={t('roomCode')}
                value={code}
                maxLength={ROOM_CODE_LENGTH}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              />
              <Button
                tone={invited ? 'primary' : 'brass'}
                disabled={busy || code.length !== ROOM_CODE_LENGTH}
                onClick={() => join()}
                data-testid="join-room"
              >
                {t('joinRoom')}
              </Button>
            </div>
          </div>
          {invited && (
            <button type="button" className="mt-4 w-full text-sm text-porcelain/60 underline" onClick={() => setCode('')}>
              {t('createRoom')}
            </button>
          )}
          {error && (
            <p className="mt-3 text-sm text-brass-soft" role="alert">
              {error}
            </p>
          )}
        </form>
      </div>
    </main>
  );
}
