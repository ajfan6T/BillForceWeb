import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { BillforceApp } from './src/core/app';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import {
  writeFileSafely,
  type FileFilter,
  type Platform,
  type PrinterInfo,
  type PrintOptions,
  type PrintResult,
} from './src/core/platform';
import {
  getSyncState,
  loadSupabaseConfig,
  saveSupabaseConfig,
  runFullSync,
} from './src/core/supabase/syncService';
import { testSupabaseConnection } from './src/core/supabase/client';
import { SUPABASE_SCHEMA_SQL } from './src/core/supabase/schemaSql';

const isProduction = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT || 3000);
const dataDir = path.resolve(process.env.BILLFORCE_DATA_DIR || './data');
fs.mkdirSync(dataDir, { recursive: true });

class WebPlatform implements Platform {
  kind = 'web' as const;
  nextPickFile: string | null = null;
  nextPickFolder: string | null = null;
  printCount = 0;

  async printHtml(html: string, opts: PrintOptions): Promise<PrintResult> {
    const dir = path.join(dataDir, 'prints');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `print-${String(++this.printCount).padStart(4, '0')}.html`);
    fs.writeFileSync(file, html);
    fs.writeFileSync(path.join(dir, 'last.json'), JSON.stringify({ file, opts }));
    return { printed: true };
  }

  async listPrinters(): Promise<PrinterInfo[]> {
    return [
      { name: 'POS-80', displayName: 'POS-80 Thermal Printer (Online / Cloud)', isDefault: false },
      { name: 'Browser / PDF Printer', displayName: 'Print to PDF / Browser', isDefault: true },
    ];
  }

  async htmlToPdf(html: string): Promise<Uint8Array> {
    return new TextEncoder().encode(`%PDF-1.4\n% Billforce Cloud Document\n${html}`);
  }

  async saveFile(opts: { defaultName: string; data: Uint8Array | string; filters?: FileFilter[] }): Promise<string | null> {
    const dir = path.join(dataDir, 'downloads');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, opts.defaultName);
    await writeFileSafely(file, opts.data);
    return file;
  }

  async pickFile(): Promise<string | null> {
    const f = this.nextPickFile;
    this.nextPickFile = null;
    return f;
  }

  async pickFolder(): Promise<string | null> {
    const f = this.nextPickFolder;
    this.nextPickFolder = null;
    return f;
  }

  async openPath(): Promise<void> {}
  showInFolder(): void {}

  documentsDir(): string {
    return path.join(dataDir, 'documents');
  }
}

const platform = new WebPlatform();
const app = new BillforceApp({ dataDir, platform, version: '1.2.0-supabase' });

// Load initial Supabase configuration from DB / env
loadSupabaseConfig(app.db);

const events: string[] = [];
app.onEvent((e) => events.push(e));

async function startServer() {
  const server = express();
  server.use(express.json({ limit: '50mb' }));

  // API endpoints
  server.post('/api/invoke', async (req, res) => {
    try {
      const { name, input } = req.body || {};
      const result = await app.invoke(name, input);
      res.json(result);
    } catch (e: any) {
      console.error('API /api/invoke error:', e);
      res.status(500).json({ ok: false, error: { code: 'INTERNAL', message: e.message } });
    }
  });

  server.get('/api/events', (_req, res) => {
    res.json(events.splice(0));
  });

  // Dedicated Supabase Cloud API Endpoints
  server.get('/api/supabase/status', (_req, res) => {
    res.json(getSyncState());
  });

  server.get('/api/supabase/config', (_req, res) => {
    const cfg = loadSupabaseConfig(app.db);
    res.json({
      url: cfg.url || '',
      anonKey: cfg.anonKey || '',
      autoSync: cfg.autoSync !== false,
      syncIntervalSec: cfg.syncIntervalSec || 30,
      lastSyncedAt: cfg.lastSyncedAt || null,
      hasKey: !!cfg.anonKey,
    });
  });

  server.post('/api/supabase/config', async (req, res) => {
    try {
      const { url, anonKey, autoSync, syncIntervalSec } = req.body;
      const updated = saveSupabaseConfig(app.db, {
        url: url?.trim() || '',
        anonKey: anonKey?.trim() || '',
        autoSync: autoSync !== false,
        syncIntervalSec: Number(syncIntervalSec) || 30,
      });

      const test = await testSupabaseConnection({
        url: updated.url,
        anonKey: updated.anonKey,
      });

      res.json({
        ok: true,
        testResult: test,
        config: {
          url: updated.url,
          autoSync: updated.autoSync,
          hasKey: !!updated.anonKey,
        },
      });
    } catch (e: any) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  server.post('/api/supabase/test', async (req, res) => {
    try {
      const result = await testSupabaseConnection(req.body);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  server.post('/api/supabase/sync', async (_req, res) => {
    try {
      const result = await runFullSync(app);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  server.get('/api/supabase/schema', (_req, res) => {
    res.json({ sql: SUPABASE_SCHEMA_SQL });
  });

  // Health checks for Cloud Run, Docker, and Kubernetes
  server.get(['/health', '/api/health', '/_health'], (_req, res) => {
    res.status(200).json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
  });

  // Vite middleware in dev; static in production
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    server.use(vite.middlewares);
  } else {
    // Look for dist folder in current directory or next to script
    let distPath = path.resolve(__dirname, 'dist');
    if (!fs.existsSync(distPath)) {
      distPath = path.resolve(process.cwd(), 'dist');
    }
    server.use(express.static(distPath));
    server.get('*', (_req, res) => {
      const indexHtml = path.join(distPath, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(200).send('<!doctype html><html><head><title>Billforce</title></head><body><h2>Billforce Server Starting...</h2><p>Please reload in a moment.</p></body></html>');
      }
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Billforce Supabase Cloud ERP listening on 0.0.0.0:${PORT} (PID: ${process.pid})`);
    // Auto-sync on startup if configured
    try {
      const cfg = loadSupabaseConfig(app.db);
      if (cfg.url && cfg.anonKey && cfg.autoSync) {
        setTimeout(() => {
          runFullSync(app).catch((e) => console.log('[Startup Sync]', e.message));
        }, 2000);
      }
    } catch (e: any) {
      console.warn('Initial sync notice:', e.message);
    }
  });
}


startServer().catch((e) => {
  console.error('Failed to start Billforce server:', e);
  process.exit(1);
});
