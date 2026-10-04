/**
 * Platform for Billforce running as a web server. Printing and saving files
 * happen in the user's browser, so instead of doing them on the server the
 * calls are collected as "client actions" and sent back with the API reply:
 *  - print:    the browser prints the HTML (receipt, report) with its own print dialog;
 *  - download: the browser downloads a file kept for a few minutes behind a one-time link.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import path from 'node:path';
import type { FileFilter, Platform, PrinterInfo, PrintOptions, PrintResult } from './platform';

export type ClientAction =
  | { type: 'print'; html: string; paperWidthMm?: number; copies?: number }
  | { type: 'download'; url: string; fileName: string };

export interface PendingDownload {
  fileName: string;
  data: Buffer;
  mime: string;
  expiresAt: number;
}

const DOWNLOAD_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_DOWNLOADS = 200;

const actionStore = new AsyncLocalStorage<ClientAction[]>();
const downloads = new Map<string, PendingDownload>();

/** Run one API call and collect what the browser has to do afterwards. */
export async function withClientActions<T>(fn: () => Promise<T>): Promise<{ result: T; actions: ClientAction[] }> {
  const actions: ClientAction[] = [];
  const result = await actionStore.run(actions, fn);
  return { result, actions };
}

const MIME: Record<string, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
  html: 'text/html; charset=utf-8',
  bfbackup: 'application/octet-stream',
};

function dropExpired(at = Date.now()): void {
  for (const [key, d] of downloads) if (d.expiresAt < at) downloads.delete(key);
  // Never let forgotten downloads pile up in memory.
  while (downloads.size > MAX_PENDING_DOWNLOADS) downloads.delete(downloads.keys().next().value!);
}

/** Keep a file for the browser to download; returns the one-time link, or null outside an API call. */
export function offerDownload(fileName: string, data: Uint8Array | string): { url: string; fileName: string } | null {
  const actions = actionStore.getStore();
  if (!actions) return null;
  dropExpired();
  const key = crypto.randomBytes(24).toString('base64url');
  const safeName = fileName.replace(/[\\/:*?"<>|\r\n]+/g, '-').slice(0, 150) || 'download';
  const ext = path.extname(safeName).slice(1).toLowerCase();
  downloads.set(key, {
    fileName: safeName,
    data: typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data.buffer, data.byteOffset, data.byteLength),
    mime: MIME[ext] ?? 'application/octet-stream',
    expiresAt: Date.now() + DOWNLOAD_TTL_MS,
  });
  const action = { type: 'download' as const, url: `/api/download/${key}`, fileName: safeName };
  actions.push(action);
  return action;
}

/** The file behind a download link (each link works once). */
export function takeDownload(key: string): PendingDownload | null {
  dropExpired();
  const d = downloads.get(key);
  if (!d) return null;
  downloads.delete(key);
  return d;
}

export class WebPlatform implements Platform {
  kind = 'web' as const;

  constructor(private dataDir: string) {}

  async printHtml(html: string, opts: PrintOptions): Promise<PrintResult> {
    const actions = actionStore.getStore();
    if (!actions) return { printed: false, message: 'Printing is done from the browser.' };
    actions.push({ type: 'print', html, paperWidthMm: opts.paperWidthMm, copies: opts.copies });
    return { printed: true };
  }

  /** The browser chooses the printer in its own print dialog. */
  async listPrinters(): Promise<PrinterInfo[]> {
    return [];
  }

  async htmlToPdf(): Promise<Uint8Array> {
    throw new Error('PDF files are made by the browser: use Print and choose "Save as PDF".');
  }

  async saveFile(opts: { defaultName: string; data: Uint8Array | string; filters?: FileFilter[] }): Promise<string | null> {
    return offerDownload(opts.defaultName, opts.data)?.fileName ?? null;
  }

  async pickFile(): Promise<string | null> {
    return null;
  }

  async pickFolder(): Promise<string | null> {
    return null;
  }

  async openPath(): Promise<void> {}

  showInFolder(): void {}

  documentsDir(): string {
    return path.join(this.dataDir, 'documents');
  }
}
