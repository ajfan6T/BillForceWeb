import type { FileFilter, Platform, PrinterInfo, PrintOptions, PrintResult } from '../core/platform';
import { downloadData, printInBrowser } from '../renderer/browserActions';

/** The browser edition prints and saves straight from the page. */
export class BrowserPlatform implements Platform {
  kind = 'web' as const;

  async printHtml(html: string, opts: PrintOptions): Promise<PrintResult> {
    printInBrowser(html, opts.copies ?? 1);
    return { printed: true };
  }

  async listPrinters(): Promise<PrinterInfo[]> {
    return [];
  }

  async htmlToPdf(): Promise<Uint8Array> {
    throw new Error('PDF files are made by the browser: use Print and choose "Save as PDF".');
  }

  async saveFile(opts: { defaultName: string; data: Uint8Array | string; filters?: FileFilter[] }): Promise<string | null> {
    downloadData(opts.defaultName, opts.data);
    return opts.defaultName;
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
    return '/documents';
  }
}
