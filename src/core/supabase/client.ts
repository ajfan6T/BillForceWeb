import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SupabaseConfig } from '../../shared/supabaseConfig';

let currentClient: SupabaseClient | null = null;
let currentConfig: SupabaseConfig | null = null;

export function getSupabaseServerClient(config?: SupabaseConfig): SupabaseClient | null {
  if (config) {
    if (config.url && config.anonKey) {
      if (!currentClient || currentConfig?.url !== config.url || currentConfig?.anonKey !== config.anonKey) {
        currentClient = createClient(config.url, config.anonKey, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
        });
        currentConfig = { ...config };
      }
      return currentClient;
    }
  }

  if (currentClient) return currentClient;

  const envUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const envKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (envUrl && envKey) {
    currentClient = createClient(envUrl, envKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    currentConfig = {
      url: envUrl,
      anonKey: envKey,
      autoSync: true,
      syncIntervalSec: 30,
    };
    return currentClient;
  }

  return null;
}

export async function testSupabaseConnection(config: { url: string; anonKey: string }): Promise<{
  success: boolean;
  message: string;
  tablesFound?: string[];
  latencyMs?: number;
}> {
  if (!config.url || !config.anonKey) {
    return { success: false, message: 'Supabase URL and Anon Key are required.' };
  }

  const start = Date.now();
  try {
    const client = createClient(config.url, config.anonKey, {
      auth: { persistSession: false },
    });

    // Test simple select or auth ping
    const { data, error } = await client.from('billforce_settings').select('key').limit(1);

    const latencyMs = Date.now() - start;

    if (error) {
      // If table doesn't exist yet, we check if connection itself is good
      if (
        error.code === '42P01' ||
        error.code === 'PGRST205' ||
        error.message?.includes('relation "billforce_settings" does not exist') ||
        error.message?.includes('schema cache')
      ) {
        return {
          success: true,
          message: 'Connected to Supabase! (Tables need to be created with the SQL setup script).',
          latencyMs,
          tablesFound: [],
        };
      }
      return {
        success: false,
        message: `Connection error: ${error.message} (code: ${error.code || 'unknown'})`,
        latencyMs,
      };
    }

    return {
      success: true,
      message: 'Successfully connected to Supabase database!',
      latencyMs,
      tablesFound: ['billforce_settings'],
    };
  } catch (e: any) {
    return {
      success: false,
      message: `Failed to reach Supabase: ${e.message || String(e)}`,
    };
  }
}
