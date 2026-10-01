export interface SupabaseConfig {
  url: string;
  anonKey: string;
  serviceKey?: string;
  autoSync: boolean;
  syncIntervalSec: number;
  lastSyncedAt?: string | null;
}

export interface SupabaseSyncStats {
  customers: number;
  suppliers: number;
  items: number;
  bills: number;
  purchases: number;
  accounts: number;
  journals: number;
  employees: number;
  stockMoves: number;
  settings: number;
}

export interface SupabaseSyncState {
  configured: boolean;
  connected: boolean;
  status: 'idle' | 'syncing' | 'synced' | 'error' | 'offline';
  lastSyncedAt: string | null;
  errorMessage?: string | null;
  stats?: SupabaseSyncStats;
  supabaseUser?: {
    id: string;
    email?: string;
    role?: string;
  } | null;
}

export const DEFAULT_SUPABASE_CONFIG: SupabaseConfig = {
  url: (typeof process !== 'undefined' && process.env?.VITE_SUPABASE_URL) || '',
  anonKey: (typeof process !== 'undefined' && process.env?.VITE_SUPABASE_ANON_KEY) || '',
  autoSync: true,
  syncIntervalSec: 30,
  lastSyncedAt: null,
};
