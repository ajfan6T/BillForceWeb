import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SupabaseConfig } from '../../shared/supabaseConfig';

const clients = new Map<string, SupabaseClient>();

/** A server-side client for one business's Supabase project (null when it is not set up). */
export function getSupabaseServerClient(config: SupabaseConfig): SupabaseClient | null {
  if (!config.url || !config.anonKey) return null;
  const key = `${config.url}\n${config.anonKey}`;
  let client = clients.get(key);
  if (!client) {
    client = createClient(config.url, config.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    clients.set(key, client);
  }
  return client;
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
  if (!/^https:\/\/[^\s/]+/i.test(config.url)) {
    return { success: false, message: 'The Supabase URL must start with https://' };
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
