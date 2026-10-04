/**
 * What the Windows app does for the Billforce core: print straight to a printer (or with the
 * Windows print window), make real PDF files, and show Save / Open / folder dialogs.
 */
import { app, BrowserWindow, dialog, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { writeFileSafely, type FileFilter, type Platform, type PrinterInfo, type PrintOptions, type PrintResult } from '../src/core/platform';

let printCounter = 0;

export class ElectronPlatform implements Platform {
  kind = 'electron' as const;
  /** Last folder a file was saved in, offered again next time. */
  private lastSaveDir: string | null = null;

  /** tempDir: where HTML is put for printing; mainWindow: the app window (dialogs belong to it). */
  constructor(
    private readonly tempDir: string,
    private readonly mainWindow: () => BrowserWindow | null,
  ) {}

  /** Load HTML into a hidden window (from a temporary file: long reports are too big for a URL). Scripts never run in it. */
  private async withPage<T>(html: string, fn: (win: BrowserWindow) => Promise<T>): Promise<T> {
    fs.mkdirSync(this.tempDir, { recursive: true });
    const file = path.join(this.tempDir, `print-${process.pid}-${++printCounter}.html`);
    fs.writeFileSync(file, html, 'utf8');
    const parent = this.mainWindow() ?? undefined;
    const win = new BrowserWindow({
      show: false,
      width: 900,
      height: 1200,
      parent,
      webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
    });
    try {
      await win.loadFile(file);
      return await fn(win);
    } finally {
      if (!win.isDestroyed()) win.destroy();
      fs.rmSync(file, { force: true });
    }
  }

  async printHtml(html: string, opts: PrintOptions): Promise<PrintResult> {
    const printerName = opts.printerName?.trim() || undefined;
    const silent = !!(opts.silent && printerName);
    try {
      return await this.withPage(html, (win) => {
        return new Promise<PrintResult>((resolve) => {
          win.webContents.print(
            {
              silent,
              deviceName: printerName,
              printBackground: true,
              copies: Math.max(1, Math.min(10, opts.copies ?? 1)),
              // Receipts use the whole width of the paper roll; reports keep the margins of their page style.
              ...(opts.paperWidthMm ? { margins: { marginType: 'none' as const } } : {}),
            },
            (success, failureReason) => resolve(success ? { printed: true } : { printed: false, message: failureReason || 'The bill was not printed' }),
          );
        });
      });
    } catch (e) {
      return { printed: false, message: (e as Error)?.message ?? String(e) };
    }
  }

  async listPrinters(): Promise<PrinterInfo[]> {
    const win = this.mainWindow();
    const list = win && !win.isDestroyed() ? await win.webContents.getPrintersAsync() : await this.withPage('<!doctype html><title>Printers</title>', (w) => w.webContents.getPrintersAsync());
    return list.map((p) => {
      const options = (p.options ?? {}) as Record<string, string>;
      const isDefault = (p as { isDefault?: boolean }).isDefault === true || options['is-default'] === 'true';
      return { name: p.name, displayName: p.displayName || p.name, isDefault };
    });
  }

  async htmlToPdf(html: string, opts: { landscape?: boolean }): Promise<Uint8Array> {
    const pdf = await this.withPage(html, (win) => win.webContents.printToPDF({ printBackground: true, landscape: !!opts.landscape, preferCSSPageSize: true }));
    return new Uint8Array(pdf.buffer, pdf.byteOffset, pdf.byteLength);
  }

  async saveFile(opts: { defaultName: string; data: Uint8Array | string; filters?: FileFilter[] }): Promise<string | null> {
    const startDir = this.lastSaveDir && fs.existsSync(this.lastSaveDir) ? this.lastSaveDir : this.documentsDir();
    const options = { title: 'Save', defaultPath: path.join(startDir, opts.defaultName), filters: opts.filters };
    const parent = this.mainWindow();
    const res = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
    if (res.canceled || !res.filePath) return null;
    await writeFileSafely(res.filePath, opts.data);
    this.lastSaveDir = path.dirname(res.filePath);
    return res.filePath;
  }

  async pickFile(opts: { title?: string; filters?: FileFilter[] }): Promise<string | null> {
    const options = { title: opts.title, filters: opts.filters, properties: ['openFile' as const] };
    const parent = this.mainWindow();
    const res = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    return res.canceled ? null : (res.filePaths[0] ?? null);
  }

  async pickFolder(opts: { title?: string; defaultPath?: string }): Promise<string | null> {
    const options = { title: opts.title, defaultPath: opts.defaultPath, properties: ['openDirectory' as const, 'createDirectory' as const] };
    const parent = this.mainWindow();
    const res = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    return res.canceled ? null : (res.filePaths[0] ?? null);
  }

  async openPath(p: string): Promise<void> {
    const problem = await shell.openPath(p);
    if (problem) throw new Error(problem);
  }

  showInFolder(p: string): void {
    shell.showItemInFolder(p);
  }

  documentsDir(): string {
    return app.getPath('documents');
  }
}
