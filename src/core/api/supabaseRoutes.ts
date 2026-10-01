import { z } from 'zod';
import { route } from './router';
import {
  getSyncState,
  loadSupabaseConfig,
  saveSupabaseConfig,
  runFullSync,
} from '../supabase/syncService';
import { testSupabaseConnection } from '../supabase/client';
import { SUPABASE_SCHEMA_SQL } from '../supabase/schemaSql';

export const supabaseRoutes = {
  'supabase.status': route({
    access: 'public',
    handler: (ctx) => {
      // Ensure config is loaded
      loadSupabaseConfig(ctx.db);
      return getSyncState();
    },
  }),

  'supabase.getConfig': route({
    access: 'user',
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
    access: 'user',
    input: z.object({
      url: z.string().trim(),
      anonKey: z.string().trim(),
      autoSync: z.boolean().default(true),
      syncIntervalSec: z.number().min(5).max(3600).default(30),
    }),
    handler: async (ctx, input) => {
      const updated = saveSupabaseConfig(ctx.db, {
        url: input.url,
        anonKey: input.anonKey,
        autoSync: input.autoSync,
        syncIntervalSec: input.syncIntervalSec,
      });

      // Quick test
      const test = await testSupabaseConnection({
        url: updated.url,
        anonKey: updated.anonKey,
      });

      return {
        ok: true,
        testResult: test,
        config: {
          url: updated.url,
          autoSync: updated.autoSync,
          hasKey: !!updated.anonKey,
        },
      };
    },
  }),

  'supabase.testConnection': route({
    access: 'user',
    input: z.object({
      url: z.string().trim(),
      anonKey: z.string().trim(),
    }),
    handler: async (_ctx, input) => {
      return await testSupabaseConnection(input);
    },
  }),

  'supabase.syncNow': route({
    access: 'user',
    handler: async (ctx) => {
      // app instance is accessible from app hooks or context
      const app = (ctx as any).appInstance;
      if (!app) {
        return { success: false, message: 'App instance not ready for sync' };
      }
      return await runFullSync(app);
    },
  }),

  'supabase.getSchemaSql': route({
    access: 'user',
    handler: () => {
      return { sql: SUPABASE_SCHEMA_SQL };
    },
  }),
};
