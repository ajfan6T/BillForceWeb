import { z } from 'zod';
import { route } from './router';
import { getSyncState, loadSupabaseConfig, saveSupabaseConfig, runFullSync } from '../supabase/syncService';
import { testSupabaseConnection } from '../supabase/client';
import { SUPABASE_SCHEMA_SQL } from '../supabase/schemaSql';

const zUrl = z
  .string()
  .trim()
  .max(300)
  .refine((v) => !v || /^https:\/\/[^\s/]+/i.test(v), 'The Supabase URL must start with https://');

/** Optional copy of this business's data to its own Supabase project. */
export const supabaseRoutes = {
  'supabase.status': route({ access: 'user', handler: (ctx) => getSyncState(ctx.db) }),

  'supabase.getConfig': route({
    access: 'settings.manage',
    handler: (ctx) => {
      const cfg = loadSupabaseConfig(ctx.db);
      return {
        url: cfg.url || '',
        anonKey: cfg.anonKey || '',
        autoSync: cfg.autoSync !== false,
        syncIntervalSec: cfg.syncIntervalSec || 30,
        lastSyncedAt: cfg.lastSyncedAt || null,
        hasKey: !!cfg.anonKey,
      };
    },
  }),

  'supabase.saveConfig': route({
    access: 'settings.manage',
    input: z.object({
      url: zUrl,
      anonKey: z.string().trim().max(2000),
      autoSync: z.boolean().default(true),
      syncIntervalSec: z.number().min(5).max(3600).default(30),
    }),
    handler: async (ctx, input) => {
      const updated = saveSupabaseConfig(ctx.db, input);
      const test = updated.url && updated.anonKey ? await testSupabaseConnection({ url: updated.url, anonKey: updated.anonKey }) : null;
      return { ok: true, testResult: test, config: { url: updated.url, autoSync: updated.autoSync, hasKey: !!updated.anonKey } };
    },
  }),

  'supabase.testConnection': route({
    access: 'settings.manage',
    input: z.object({ url: zUrl, anonKey: z.string().trim().max(2000) }),
    handler: (_ctx, input) => testSupabaseConnection(input),
  }),

  'supabase.syncNow': route({ access: 'settings.manage', handler: (ctx) => runFullSync(ctx.db) }),

  'supabase.getSchemaSql': route({ access: 'settings.manage', handler: () => ({ sql: SUPABASE_SCHEMA_SQL }) }),
};
