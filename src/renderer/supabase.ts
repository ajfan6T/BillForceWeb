import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { SupabaseConfig, SupabaseSyncState } from '../shared/supabaseConfig';
import { DEFAULT_SUPABASE_CONFIG } from '../shared/supabaseConfig';

let client: SupabaseClient | null = null;
let cachedConfig: SupabaseConfig = { ...DEFAULT_SUPABASE_CONFIG };

export function getClientConfig(): SupabaseConfig {
  try {
    const saved = localStorage.getItem('billforce:supabase_config');
    if (saved) {
      cachedConfig = { ...DEFAULT_SUPABASE_CONFIG, ...JSON.parse(saved) };
      return cachedConfig;
    }
  } catch (e) {
    /* ignore */
  }

  const envUrl = (import.meta as any).env?.VITE_SUPABASE_URL || '';
  const envKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';

  if (envUrl && envKey) {
    cachedConfig = {
      ...DEFAULT_SUPABASE_CONFIG,
      url: envUrl,
      anonKey: envKey,
    };
  }
  return cachedConfig;
}

export function saveClientConfig(config: Partial<SupabaseConfig>): SupabaseConfig {
  cachedConfig = { ...getClientConfig(), ...config };
  try {
    localStorage.setItem('billforce:supabase_config', JSON.stringify(cachedConfig));
  } catch (e) {
    /* ignore */
  }

  // Re-instantiate client
  if (cachedConfig.url && cachedConfig.anonKey) {
    client = createClient(cachedConfig.url, cachedConfig.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });
  } else {
    client = null;
  }
  return cachedConfig;
}

export function getSupabase(): SupabaseClient | null {
  if (client) return client;
  const cfg = getClientConfig();
  if (cfg.url && cfg.anonKey) {
    client = createClient(cfg.url, cfg.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });
    return client;
  }
  return null;
}

export async function fetchSyncStatus(): Promise<SupabaseSyncState> {
  try {
    const res = await fetch('/api/supabase/status');
    if (res.ok) {
      return (await res.json()) as SupabaseSyncState;
    }
  } catch {
    /* ignore */
  }
  const cfg = getClientConfig();
  return {
    configured: !!(cfg.url && cfg.anonKey),
    connected: false,
    status: cfg.url ? 'offline' : 'idle',
    lastSyncedAt: cfg.lastSyncedAt || null,
  };
}

export async function triggerCloudSync(): Promise<{
  success: boolean;
  message: string;
  stats?: any;
}> {
  try {
    const res = await fetch('/api/supabase/sync', { method: 'POST' });
    return (await res.json()) as { success: boolean; message: string; stats?: any };
  } catch (e: any) {
    return { success: false, message: `Sync failed: ${e.message || String(e)}` };
  }
}

export async function saveCloudConfig(config: {
  url: string;
  anonKey: string;
  autoSync?: boolean;
  syncIntervalSec?: number;
}): Promise<any> {
  saveClientConfig(config);
  try {
    const res = await fetch('/api/supabase/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(config),
    });
    return await res.json();
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function testConnection(config: { url: string; anonKey: string }): Promise<any> {
  try {
    const res = await fetch('/api/supabase/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(config),
    });
    return await res.json();
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function getPostgresSchemaSql(): Promise<string> {
  try {
    const res = await fetch('/api/supabase/schema');
    const data = await res.json();
    return data.sql || '';
  } catch {
    return '';
  }
}

/* ---------------- Supabase Auth Services ---------------- */

export async function getSupabaseAuthUser(): Promise<User | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data } = await sb.auth.getUser();
    return data.user;
  } catch {
    return null;
  }
}

export async function signInWithSupabase(email: string, password: string) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase is not configured. Please set URL and Anon Key in Settings.');
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUpWithSupabase(email: string, password: string) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase is not configured. Please set URL and Anon Key in Settings.');
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signOutSupabase() {
  const sb = getSupabase();
  if (!sb) return;
  await sb.auth.signOut();
}
