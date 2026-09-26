import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { sessionApi, setCsrfToken, type SessionPayload } from '../lib/api';

interface SessionContextValue {
  session: SessionPayload | null;
  loading: boolean;
  refresh: () => Promise<SessionPayload | null>;
  ensureGuest: (name: string, avatarSeed: number) => Promise<SessionPayload>;
}

const SessionContext = createContext<SessionContextValue>({
  session: null,
  loading: true,
  refresh: async () => null,
  ensureGuest: async () => {
    throw new Error('SessionProvider missing');
  },
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const apply = useCallback((payload: SessionPayload | null) => {
    setSession(payload);
    setCsrfToken(payload?.csrfToken ?? null);
    return payload;
  }, []);

  const refresh = useCallback(async () => {
    try {
      const payload = await sessionApi.get();
      return apply(payload);
    } catch {
      return apply(null);
    }
  }, [apply]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const payload = await sessionApi.get();
        if (!cancelled) apply(payload);
      } catch {
        if (!cancelled) apply(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apply]);

  const ensureGuest = useCallback(
    async (name: string, avatarSeed: number) => {
      const payload = await sessionApi.guest(name, avatarSeed);
      return apply(payload) as SessionPayload;
    },
    [apply],
  );

  const value = useMemo(
    () => ({ session, loading, refresh, ensureGuest }),
    [session, loading, refresh, ensureGuest],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  return useContext(SessionContext);
}
