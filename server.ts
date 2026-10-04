import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { BillforceApp } from './src/core/app';
import { can } from './src/core/context';
import { WebPlatform, takeDownload, withClientActions } from './src/core/web';
import { saveUpload } from './src/core/modules/data/uploads';
import { APP_VERSION } from './src/shared/version';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** The built bundle (dist/server.js) always serves the built app; `npm run dev` uses Vite. */
const isProduction = process.env.NODE_ENV === 'production' || path.basename(__dirname) === 'dist';
const PORT = Number(process.env.PORT || 3000);
const dataDir = path.resolve(process.env.BILLFORCE_DATA_DIR || './data');
/** BILLFORCE_REGISTRATION=closed turns off "Register business" (only existing businesses can sign in). */
const registrationOpen = (process.env.BILLFORCE_REGISTRATION || 'open').trim().toLowerCase() !== 'closed';
const MAX_UPLOAD_MB = Number(process.env.BILLFORCE_MAX_UPLOAD_MB || 200);

const app = new BillforceApp({ dataDir, platform: new WebPlatform(dataDir), version: APP_VERSION, registrationOpen });

/* ------------------------------ Rate limits for sign-in pages ------------------------------ */

/** [requests, window in ms] per client address (and business, for logins). */
const LIMITS: Record<string, [number, number]> = {
  'auth.login': [30, 60_000],
  'auth.recover': [10, 15 * 60_000],
  'business.register': [10, 60 * 60_000],
  upload: [20, 60 * 60_000],
};
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(kind: string, who: string): boolean {
  const limit = LIMITS[kind];
  if (!limit) return false;
  const now = Date.now();
  if (hits.size > 50_000) for (const [k, v] of hits) if (v.resetAt < now) hits.delete(k);
  const key = `${kind}|${who}`;
  const entry = hits.get(key);
  if (!entry || entry.resetAt < now) {
    hits.set(key, { count: 1, resetAt: now + limit[1] });
    return false;
  }
  entry.count++;
  return entry.count > limit[0];
}

function bearerToken(req: express.Request): string | null {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() || null : null;
}

const TOO_MANY = { ok: false, error: { code: 'VALIDATION', message: 'Too many attempts. Please wait a few minutes and try again.' } };

async function startServer() {
  const server = express();
  server.disable('x-powered-by');
  // Behind a load balancer / Cloud Run, TRUST_PROXY=1 makes client addresses (used by the rate limits) real.
  if (process.env.TRUST_PROXY) server.set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY);
  server.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  // Every API call: { name, input } with the session token in the Authorization header.
  server.post('/api/invoke', express.json({ limit: '10mb' }), async (req, res) => {
    try {
      const { name, input } = (req.body || {}) as { name?: unknown; input?: unknown };
      if (typeof name !== 'string' || !name) {
        res.status(400).json({ ok: false, error: { code: 'VALIDATION', message: 'Missing action name' } });
        return;
      }
      if (name in LIMITS) {
        const businessName = String((input as { businessName?: unknown } | null)?.businessName ?? '').trim().toLowerCase();
        if (rateLimited(name, `${req.ip}|${businessName}`)) {
          res.status(429).json(TOO_MANY);
          return;
        }
      }
      const { result, actions } = await withClientActions(() => app.invoke(name, input, bearerToken(req)));
      res.setHeader('Cache-Control', 'no-store');
      res.json(result.ok && actions.length ? { ...result, actions } : result);
    } catch (e) {
      console.error('API /api/invoke error:', e);
      res.status(500).json({ ok: false, error: { code: 'INTERNAL', message: 'Unexpected server error' } });
    }
  });

  // Files prepared by an API call (exports, backups): each link works once, for a few minutes.
  server.get('/api/download/:key', (req, res) => {
    const file = takeDownload(req.params.key);
    if (!file) {
      res.status(404).send('This download link has expired. Please try again from Billforce.');
      return;
    }
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName.replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(file.data);
  });

  // Upload a backup file to restore (the restore itself is the backup.restoreUpload action).
  server.post('/api/upload', express.raw({ type: () => true, limit: `${MAX_UPLOAD_MB}mb` }), (req, res) => {
    const ctx = app.ctx(bearerToken(req));
    if (!ctx.session || !ctx.businessId) {
      res.status(401).json({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'Please log in to continue' } });
      return;
    }
    if (!can(ctx, 'data.restore')) {
      res.status(403).json({ ok: false, error: { code: 'FORBIDDEN', message: 'You do not have permission to restore backups.' } });
      return;
    }
    if (rateLimited('upload', `${req.ip}|${ctx.businessId}`)) {
      res.status(429).json(TOO_MANY);
      return;
    }
    try {
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      res.json({ ok: true, data: { uploadId: saveUpload(dataDir, ctx.businessId, body) } });
    } catch (e) {
      res.status(400).json({ ok: false, error: { code: 'VALIDATION', message: (e as Error).message } });
    }
  });

  // Health checks for Cloud Run, Docker and Kubernetes
  server.get(['/health', '/api/health', '/_health'], (_req, res) => {
    res.status(200).json({ status: 'ok', version: APP_VERSION, uptime: process.uptime(), timestamp: new Date().toISOString() });
  });

  server.all('/api/*', (_req, res) => {
    res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Unknown API address' } });
  });

  // Vite middleware in development; the built files in production
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    server.use(vite.middlewares);
  } else {
    let distPath = path.resolve(__dirname, 'dist');
    if (!fs.existsSync(path.join(distPath, 'index.html'))) distPath = path.resolve(__dirname);
    if (!fs.existsSync(path.join(distPath, 'index.html'))) distPath = path.resolve(process.cwd(), 'dist');
    server.use(express.static(distPath, { index: false, maxAge: '1h' }));
    server.get('*', (_req, res) => {
      const indexHtml = path.join(distPath, 'index.html');
      if (fs.existsSync(indexHtml)) res.sendFile(indexHtml);
      else res.status(503).send('Billforce is starting. Please reload in a moment.');
    });
  }

  const listener = server.listen(PORT, '0.0.0.0', () => {
    console.log(`Billforce ERP ${APP_VERSION} listening on 0.0.0.0:${PORT} (data: ${dataDir})`);
  });

  // Finish open requests and close the databases cleanly when the platform stops the server.
  const shutdown = (signal: string) => {
    console.log(`${signal} received, shutting down`);
    listener.close(() => {
      app.close();
      process.exit(0);
    });
    setTimeout(() => {
      app.close();
      process.exit(0);
    }, 8000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch((e) => {
  console.error('Failed to start Billforce server:', e);
  process.exit(1);
});
