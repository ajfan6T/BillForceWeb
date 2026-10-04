import { useEffect, useState, useCallback } from 'react';
import type { SupabaseSyncState } from '../../shared/supabaseConfig';
import {
  fetchSyncStatus,
  triggerCloudSync,
  getSupabase,
  getSupabaseAuthUser,
} from '../supabase';
import type { User } from '@supabase/supabase-js';

export function useSupabaseSync() {
  const [syncState, setSyncState] = useState<SupabaseSyncState>({
    configured: false,
    connected: false,
    status: 'idle',
    lastSyncedAt: null,
  });
  const [loading, setLoading] = useState(false);
  const [supabaseUser, setSupabaseUser] = useState<User | null>(null);

  const refresh = useCallback(async () => {
    const s = await fetchSyncStatus();
    setSyncState(s);
    const u = await getSupabaseAuthUser();
    setSupabaseUser(u);
  }, []);

  useEffect(() => {
    refresh();

    // Periodic poll every 15s
    const timer = setInterval(refresh, 15000);

    // Supabase auth change listener
    const sb = getSupabase();
    let authSub: any = null;
    if (sb) {
      const { data } = sb.auth.onAuthStateChange((_event, session) => {
        setSupabaseUser(session?.user ?? null);
      });
      authSub = data.subscription;
    }

    return () => {
      clearInterval(timer);
      if (authSub) authSub.unsubscribe();
    };
  }, [refresh]);

  const syncNow = async () => {
    setLoading(true);
    setSyncState((s) => ({ ...s, status: 'syncing' }));
    try {
      const res = await triggerCloudSync();
      await refresh();
      return res;
    } finally {
      setLoading(false);
    }
  };

  return {
    ...syncState,
    loading,
    supabaseUser,
    refresh,
    syncNow,
  };
}
