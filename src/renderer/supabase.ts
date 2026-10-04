import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { SupabaseConfig, SupabaseSyncState } from '../shared/supabaseConfig';
import { DEFAULT_SUPABASE_CONFIG } from '../shared/supabaseConfig';
import { call, errorMessage } from './api';

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
    return await call('supabase.status');
  } catch {
    const cfg = getClientConfig();
    return {
      configured: !!(cfg.url && cfg.anonKey),
      connected: false,
      status: cfg.url ? 'offline' : 'idle',
      lastSyncedAt: cfg.lastSyncedAt || null,
    };
  }
}

export async function triggerCloudSync(): Promise<{ success: boolean; message: string; stats?: unknown }> {
  try {
    return await call('supabase.syncNow');
  } catch (e) {
    return { success: false, message: `Sync failed: ${errorMessage(e)}` };
  }
}

export async function saveCloudConfig(config: { url: string; anonKey: string; autoSync?: boolean; syncIntervalSec?: number }): Promise<any> {
  saveClientConfig(config);
  try {
    return await call('supabase.saveConfig', config);
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function testConnection(config: { url: string; anonKey: string }): Promise<any> {
  try {
    return await call('supabase.testConnection', config);
  } catch (e) {
    return { success: false, message: errorMessage(e) };
  }
}

export async function getPostgresSchemaSql(): Promise<string> {
  try {
    return (await call('supabase.getSchemaSql')).sql;
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
