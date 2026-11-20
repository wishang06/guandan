import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import type {
  Ack,
  Action,
  ClientToServerEvents,
  ErrorCode,
  RoomSettings,
  RoomView,
  Seat,
  ServerToClientEvents,
  SessionInfo,
} from '@guandan/shared';
import { KEYS, load, save } from '../lib/storage';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export type ClientError = ErrorCode | 'timeout';
export type ClientAck<T = undefined> = Ack<T> | { ok: false; error: 'timeout' };

export type ConnStatus = 'connecting' | 'online' | 'offline';

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error';
}

interface GameContextValue {
  status: ConnStatus;
  view: RoomView | null;
  session: SessionInfo | null;
  /** serverTime − Date.now(), to show deadlines on the server's clock. */
  clockOffset: number;
  replaced: boolean;
  toasts: Toast[];
  toast: (text: string, tone?: Toast['tone']) => void;
  createRoom: (nickname: string) => Promise<ClientAck<SessionInfo>>;
  joinRoom: (code: string, nickname: string) => Promise<ClientAck<SessionInfo>>;
  resume: () => void;
  leave: () => Promise<void>;
  setSeat: (seat: Seat) => Promise<ClientAck>;
  setReady: (ready: boolean) => Promise<ClientAck>;
  addBot: (seat: Seat) => Promise<ClientAck>;
  removeBot: (seat: Seat) => Promise<ClientAck>;
  fillBots: () => Promise<ClientAck>;
  updateSettings: (s: Partial<RoomSettings>) => Promise<ClientAck>;
  start: () => Promise<ClientAck>;
  act: (a: Action) => Promise<ClientAck>;
  next: () => Promise<ClientAck>;
  newMatch: () => Promise<ClientAck>;
}

const GameContext = createContext<GameContextValue | null>(null);

const SERVER_URL = (import.meta.env.VITE_SERVER_URL as string | undefined) || undefined;
const ACK_TIMEOUT = 8000;

export function GameProvider({ children }: { children: ReactNode }) {
  const socketRef = useRef<GameSocket | null>(null);
  const [status, setStatus] = useState<ConnStatus>('connecting');
  const [view, setView] = useState<RoomView | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(() => load<SessionInfo | null>(KEYS.session, null));
  const sessionRef = useRef(session);
  const [clockOffset, setClockOffset] = useState(0);
  const [replaced, setReplaced] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const toast = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = ++toastId.current;
    setToasts((ts) => [...ts.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), tone === 'error' ? 3200 : 4200);
  }, []);

  const storeSession = useCallback((s: SessionInfo | null) => {
    sessionRef.current = s;
    setSession(s);
    save(KEYS.session, s);
    const url = new URL(window.location.href);
    if (s) url.searchParams.set('room', s.code);
    else url.searchParams.delete('room');
    window.history.replaceState(null, '', url);
  }, []);

  const emit = useCallback(
    async <T,>(event: keyof ClientToServerEvents, ...args: unknown[]): Promise<ClientAck<T>> => {
      const socket = socketRef.current;
      if (!socket || !socket.connected) return { ok: false, error: 'timeout' };
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (await (socket.timeout(ACK_TIMEOUT) as any).emitWithAck(event, ...args)) as ClientAck<T>;
      } catch {
        return { ok: false, error: 'timeout' };
      }
    },
    [],
  );

  const resume = useCallback(() => {
    const s = sessionRef.current;
    const socket = socketRef.current;
    if (!s || !socket) return;
    setReplaced(false);
    void emit<SessionInfo>('room:resume', { code: s.code, token: s.token }).then((r) => {
      if (!r.ok && (r.error === 'room_not_found' || r.error === 'invalid_session')) {
        storeSession(null);
        setView(null);
      }
    });
  }, [emit, storeSession]);

  useEffect(() => {
    const socket: GameSocket = io(SERVER_URL, { autoConnect: true });
    socketRef.current = socket;
    socket.on('connect', () => {
      setStatus('online');
      resume();
    });
    socket.on('disconnect', () => setStatus('offline'));
    socket.on('connect_error', () => setStatus('offline'));
    socket.on('room:state', (v) => {
      setClockOffset(v.serverTime - Date.now());
      setView(v);
    });
    socket.on('session:replaced', () => setReplaced(true));
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [resume]);

  const value = useMemo<GameContextValue>(() => {
    const join = async (event: 'room:create' | 'room:join', payload: object) => {
      const r = await emit<SessionInfo>(event, payload);
      if (r.ok) storeSession(r.data);
      return r;
    };
    return {
      status,
      view,
      session,
      clockOffset,
      replaced,
      toasts,
      toast,
      resume,
      createRoom: (nickname) => join('room:create', { nickname }),
      joinRoom: (code, nickname) => join('room:join', { code, nickname }),
      leave: async () => {
        await emit('room:leave');
        storeSession(null);
        setView(null);
      },
      setSeat: (seat) => emit('room:seat', { seat }),
      setReady: (ready) => emit('room:ready', { ready }),
      addBot: (seat) => emit('room:addBot', { seat }),
      removeBot: (seat) => emit('room:removeBot', { seat }),
      fillBots: () => emit('room:fillBots'),
      updateSettings: (s) => emit('room:settings', s),
      start: () => emit('room:start'),
      act: (a) => emit('game:action', a),
      next: () => emit('game:next'),
      newMatch: () => emit('game:newMatch'),
    };
  }, [status, view, session, clockOffset, replaced, toasts, toast, resume, emit, storeSession]);

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame(): GameContextValue {
  const v = useContext(GameContext);
  if (!v) throw new Error('useGame outside provider');
  return v;
}

/** Re-render every `ms` (for countdowns). */
export function useNow(ms = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
