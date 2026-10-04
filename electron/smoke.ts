/**
 * Automatic check of a built app (Billforce.exe --smoke-test=<report.json>), run on every installer:
 * the screens load, the engine answers through the app's own bridge, a business can be registered and
 * billed, a backup lands in its folder, PDFs can be made and the printers read. Writes a report and quits.
 */
import { app, type BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { BillforceApp } from '../src/core/app';
import { APP_VERSION } from '../src/shared/version';
import { todayISO } from '../src/shared/dates';

interface SmokeOptions {
  win: BrowserWindow;
  core: BillforceApp;
  dataDir: string;
  backupRoot: string;
  reportPath: string;
}

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

const BUSINESS = 'Smoke Test Stores';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runSmokeTest(o: SmokeOptions): Promise<void> {
  const checks: Check[] = [];
  let done = false;
  const finish = (ok: boolean, error?: string) => {
    if (done) return;
    done = true;
    const report = { ok, version: APP_VERSION, electron: process.versions.electron, node: process.versions.node, dataDir: o.dataDir, checks, error: error ?? null };
    try {
      fs.mkdirSync(path.dirname(o.reportPath), { recursive: true });
      fs.writeFileSync(o.reportPath, JSON.stringify(report, null, 2));
    } catch (e) {
      console.error('Could not write the smoke test report:', e);
    }
    app.exit(ok ? 0 : 1);
  };
  const timeout = setTimeout(() => finish(false, 'Timed out after 3 minutes'), 180_000);

  const check = (name: string, ok: boolean, detail?: string) => {
    checks.push({ name, ok, ...(detail ? { detail } : {}) });
    if (!ok) throw new Error(`${name} failed${detail ? `: ${detail}` : ''}`);
  };
  const page = <T>(js: string): Promise<T> => o.win.webContents.executeJavaScript(js, true) as Promise<T>;
  const waitFor = async (what: string, js: string, ms = 60_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try {
        if (await page<boolean>(js)) return;
      } catch {
        /* the page may be loading */
      }
      await sleep(250);
    }
    throw new Error(`Timed out waiting for ${what}`);
  };
  /** Call the engine exactly as the screens do: through window.billforce in the page. */
  const invoke = async (name: string, input?: unknown, token?: string | null): Promise<any> => {
    const r = await page<{ ok: boolean; data?: unknown; error?: { message: string } }>(
      `window.billforce.invoke(${JSON.stringify(name)}, ${JSON.stringify(input ?? null)}, ${JSON.stringify(token ?? null)})`,
    );
    if (!r?.ok) throw new Error(`${name}: ${r?.error?.message ?? 'no answer'}`);
    return r.data;
  };

  try {
    await waitFor('the login screen', "!!document.querySelector('#root') && document.querySelector('#root').childElementCount > 0 && typeof window.billforce === 'object'");
    check('screens load', true);

    const status = await invoke('app.status');
    check('engine answers', status?.platform === 'electron', `platform ${status?.platform}`);

    const reg = await invoke('business.register', { business: { name: BUSINESS }, owner: { fullName: 'Smoke Test', username: 'owner', password: 'smoke-test-1' } });
    check('register a business', typeof reg?.token === 'string');
    const token = reg.token as string;

    const bill = await invoke('sales.create', { date: todayISO(), items: [{ itemName: 'Tea', qty: 2, rate: 1500 }], payments: [{ mode: 'cash', amount: 3000 }] }, token);
    check('save a bill', !!bill?.id);

    await invoke('settings.update', { section: 'backup', values: { frequency: 'weekly' } }, token);
    const backup = await invoke('backup.create', undefined, token);
    const backupFile = path.join(String(backup?.folder), String(backup?.fileName));
    check('back up into a folder on this computer', fs.existsSync(backupFile) && backupFile.startsWith(o.backupRoot), backupFile);

    const folder = await invoke('backup.folder', undefined, token);
    check('backup folder can be chosen', folder?.canChoose === true && folder?.folder === backup.folder);

    const about = await invoke('settings.about', undefined, token);
    check('data is a file on this computer', typeof about?.dataFile === 'string' && fs.existsSync(about.dataFile), String(about?.dataFile));

    // Sign in on the screens with the new login and see the business.
    await page(`localStorage.setItem('bf:session-token', ${JSON.stringify(token)}); setTimeout(() => location.reload(), 50); true`);
    await sleep(500);
    await waitFor('the signed-in screen', `document.body.innerText.includes(${JSON.stringify(BUSINESS)})`);
    check('signed-in screen shows the business', true);

    const pdf = await o.core.platform.htmlToPdf('<!doctype html><title>Check</title><h1>Billforce</h1>', {});
    check('make a PDF', new TextDecoder().decode(pdf.slice(0, 5)) === '%PDF-', `${pdf.byteLength} bytes`);

    const printers = await o.core.platform.listPrinters();
    check('read the printers', Array.isArray(printers), printers.map((p) => p.name).join(', ') || 'none');

    clearTimeout(timeout);
    finish(true);
  } catch (e) {
    clearTimeout(timeout);
    finish(false, (e as Error)?.message ?? String(e));
  }
}
