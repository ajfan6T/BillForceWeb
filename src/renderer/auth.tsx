import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { call, errorMessage, setSessionToken, type ApiOutput } from './api';
import { setScreenLocked } from './guards';
import { useDialogs } from './feedback';
import type { Permission } from '../shared/permissions';

type Status = ApiOutput<'app.status'>;
export type Features = Status['features'];
export type SessionInfo = NonNullable<Status['session']>;

interface AuthApi {
  status: Status | null;
  /** Billforce could not start (server unreachable, or the browser edition is open in another tab). */
  startError: string | null;
  session: SessionInfo | null;
  /** Does the logged-in user have this permission? */
  can: (p: Permission) => boolean;
  /** Any of these permissions. */
  canAny: (ps: Permission[]) => boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  /**
   * Show the lock screen (keeps the user, asks for the password again). `returnFocusTo`: where focus goes
   * after unlocking when that is not the element focused now (e.g. locking from the user menu).
   */
  lock: (returnFocusTo?: HTMLElement | null) => void;
  /** For the lock screen: the element given to the last lock() call. */
  lockReturnFocus: () => HTMLElement | null;
  locked: boolean;
  unlock: () => void;
}

const AuthContext = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status | null>(null);
  const { closeAll } = useDialogs();
  const [locked, setLockedState] = useState(false);
  const lockFocusRef = useRef<HTMLElement | null>(null);
  // The module flag is set at once (not after the next render) so no shortcut slips through while locking.
  const setLocked = useCallback((v: boolean) => {
    if (!v) lockFocusRef.current = null;
    setScreenLocked(v);
    setLockedState(v);
  }, []);

  const [startError, setStartError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const s = await call('app.status');
      setStatus(s);
      setStartError(null);
    } catch (e) {
      setStartError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onUnauth = () => void refresh();
    window.addEventListener('billforce:unauthenticated', onUnauth);
    return () => window.removeEventListener('billforce:unauthenticated', onUnauth);
  }, [refresh]);

  // Auto-lock after inactivity (Settings > Security).
  const minutes = status?.autoLockMinutes ?? 0;
  const hasSession = !!status?.session;
  // A lock belongs to a session: once logged out (or the session ended) the next login starts unlocked,
  // and no question of the previous user (e.g. "Clear this bill?") is left over the login screen.
  useEffect(() => {
    if (hasSession) return;
    setLocked(false);
    closeAll();
  }, [hasSession, setLocked, closeAll]);
  useEffect(() => {
    if (!minutes || !hasSession) return;
    let last = Date.now();
    const bump = () => {
      last = Date.now();
    };
    const events = ['mousemove', 'keydown', 'mousedown', 'wheel'];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const t = setInterval(() => {
      if (Date.now() - last > minutes * 60_000) setLocked(true);
    }, 15_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(t);
    };
  }, [minutes, hasSession, setLocked]);

  const api = useMemo<AuthApi>(() => {
    const session = status?.session ?? null;
    const perms = new Set(session?.permissions ?? []);
    const can = (p: Permission) => !!session && (session.role === 'owner' || perms.has(p));
    return {
      status,
      startError,
      session,
      can,
      canAny: (ps) => ps.some(can),
      refresh,
      logout: async () => {
        closeAll();
        try {
          await call('auth.logout');
        } catch {
          /* ignore */
        }
        setSessionToken(null);
        setLocked(false);
        await refresh();
      },
      lock: (returnFocusTo) => {
        lockFocusRef.current = returnFocusTo ?? null;
        setLocked(true);
      },
      lockReturnFocus: () => lockFocusRef.current,
      locked,
      unlock: () => setLocked(false),
    };
  }, [status, startError, locked, refresh, setLocked, closeAll]);

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const a = useContext(AuthContext);
  if (!a) throw new Error('useAuth outside AuthProvider');
  return a;
}

const NO_FEATURES: Features = { gst: 'none', gstDefaultRate: 18, gstInclusive: true, gstRegular: false, gstComposition: false, stock: false, menu: false };

/** Optional features the business has turned on (GST ...); screens for the others stay hidden. */
export function useFeatures(): Features {
  return useAuth().status?.features ?? NO_FEATURES;
}

/** Who may see cost prices (average cost, stock value, recipe cost); matches COST_PERMISSIONS in core. */
export const COST_PERMS: Permission[] = ['stock.manage', 'purchases.manage', 'suppliers.view', 'reports.financial'];

export function useCanSeeCosts(): boolean {
  return useAuth().canAny(COST_PERMS);
}

/** Render children only if the user has the permission. */
export function Can({ perm, children, fallback = null }: { perm: Permission | Permission[]; children: ReactNode; fallback?: ReactNode }) {
  const { can, canAny } = useAuth();
  const ok = Array.isArray(perm) ? canAny(perm) : can(perm);
  return <>{ok ? children : fallback}</>;
}
