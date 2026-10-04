/**
 * Billforce for Windows. The Billforce engine runs inside the app: no server and no internet needed.
 *  - Data:    %APPDATA%\Billforce\data (one database per business; kept when the app is updated or uninstalled)
 *  - Backups: Documents\Billforce Backups\<business>, or the folder chosen in Settings > Backup & recovery
 *
 * Command line (for support and for the automatic check of every installer):
 *   --data-dir=<folder>   keep the data (and its backups) in another folder
 *   --smoke-test=<file>   start, check that everything works, write the result to <file> and quit
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { BillforceApp } from '../src/core/app';
import { can } from '../src/core/context';
import { saveUpload } from '../src/core/modules/data/uploads';
import { APP_VERSION } from '../src/shared/version';
import { ElectronPlatform } from './platform';
import { runSmokeTest } from './smoke';

const PROJECT_URL = 'https://github.com/ajfan6T/BillForceWeb';

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length).replace(/^"|"$/g, '') : null;
}

const smokeReport = argValue('smoke-test');
const customDataDir = argValue('data-dir');

// The data folder must not depend on how the program file is named: always %APPDATA%\Billforce.
app.setPath('userData', path.join(app.getPath('appData'), 'BILLFORCE'));
app.setAppUserModelId('com.billforce.erp');
// The automatic check runs on computers without a graphics card.
if (smokeReport) app.disableHardwareAcceleration();

/* ------------------------------ Log file (for support) ------------------------------ */

const logFile = path.join(app.getPath('userData'), 'logs', 'billforce.log');

function writeLog(level: string, args: unknown[]): void {
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 2_000_000) fs.renameSync(logFile, `${logFile}.old`);
    const text = args
      .map((a) => {
        if (a instanceof Error) return a.stack ?? a.message;
        if (typeof a === 'string') return a;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(' ');
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${level} ${text}\n`);
  } catch {
    /* logging must never stop the app */
  }
}

for (const level of ['warn', 'error'] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    original(...args);
    writeLog(level.toUpperCase(), args);
  };
}
process.on('uncaughtException', (e) => console.error('Unexpected error:', e));
process.on('unhandledRejection', (e) => console.error('Unexpected error (promise):', e));

/* ------------------------------ Engine and window ------------------------------ */

let core: BillforceApp | null = null;
let mainWindow: BrowserWindow | null = null;

const DENIED = { ok: false, error: { code: 'FORBIDDEN', message: 'Not allowed' } };

/** Only the app's own screens (loaded from its files) may talk to the engine. */
function fromAppPage(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? '';
  return url.startsWith('file://') && !!mainWindow && !mainWindow.isDestroyed() && event.sender.id === mainWindow.webContents.id;
}

function registerIpc(engine: BillforceApp, dataDir: string): void {
  ipcMain.handle('billforce:invoke', async (event, name: unknown, input: unknown, token: unknown) => {
    if (!fromAppPage(event)) return DENIED;
    if (typeof name !== 'string' || !name || name.length > 100) return { ok: false, error: { code: 'VALIDATION', message: 'Missing action name' } };
    return engine.invoke(name, input, typeof token === 'string' ? token : null);
  });

  // A backup file chosen on this computer, kept for backup.inspectUpload / backup.restoreUpload.
  ipcMain.handle('billforce:upload', async (event, data: unknown, token: unknown) => {
    if (!fromAppPage(event)) return DENIED;
    const ctx = engine.ctx(typeof token === 'string' ? token : null);
    if (!ctx.session || !ctx.businessId) return { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Please log in to continue' } };
    if (!can(ctx, 'data.restore')) return { ok: false, error: { code: 'FORBIDDEN', message: 'You do not have permission to restore backups.' } };
    if (!(data instanceof Uint8Array)) return { ok: false, error: { code: 'VALIDATION', message: 'The file could not be read.' } };
    try {
      return { ok: true, data: { uploadId: saveUpload(dataDir, ctx.businessId, data) } };
    } catch (e) {
      return { ok: false, error: { code: 'VALIDATION', message: (e as Error).message } };
    }
  });
}

function openOutside(url: string): void {
  if (/^(https?:|mailto:)/i.test(url)) void shell.openExternal(url);
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'BILLFORCE',
    backgroundColor: '#f8fafc',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => {
    if (!smokeReport) win.maximize();
    win.show();
  });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  // Websites open in the normal browser; the app window only ever shows Billforce.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file://')) return;
    event.preventDefault();
    openOutside(url);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('The BILLFORCE screen stopped:', details.reason);
    if (details.reason !== 'clean-exit' && !win.isDestroyed()) win.reload();
  });
  void win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  return win;
}

function buildMenu(dataDir: string): Menu {
  return Menu.buildFromTemplate([
    { label: 'File', submenu: [{ role: 'quit', label: 'Exit' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }, { role: 'toggleDevTools' }],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Open data folder', click: () => void shell.openPath(dataDir) },
        { label: 'Open log file', click: () => void (fs.existsSync(logFile) ? shell.openPath(logFile) : shell.openPath(path.dirname(logFile))) },
        { label: 'BILLFORCE website', click: () => void shell.openExternal(PROJECT_URL) },
        { type: 'separator' },
        { label: `BILLFORCE ${APP_VERSION}`, enabled: false },
      ],
    },
  ]);
}

function start(): void {
  // The automatic check never touches real data: it uses the given folder or a new temporary one.
  const dataDir = customDataDir
    ? path.resolve(customDataDir)
    : smokeReport
      ? fs.mkdtempSync(path.join(app.getPath('temp'), 'billforce-smoke-'))
      : path.join(app.getPath('userData'), 'data');
  const backupRoot = customDataDir || smokeReport ? path.join(dataDir, 'backups') : path.join(app.getPath('documents'), 'BILLFORCE Backups');
  const platform = new ElectronPlatform(path.join(app.getPath('temp'), 'billforce-print'), () => mainWindow);
  try {
    core = new BillforceApp({ dataDir, platform, version: APP_VERSION, backupRoot });
  } catch (e) {
    console.error('BILLFORCE could not open its data:', e);
    dialog.showErrorBox(
      'BILLFORCE could not start',
      `BILLFORCE could not open its data folder:\n${dataDir}\n\n${(e as Error)?.message ?? e}\n\nRestart the computer and try again. If it keeps happening, send the log file to support:\n${logFile}`,
    );
    app.exit(1);
    return;
  }
  registerIpc(core, dataDir);
  Menu.setApplicationMenu(buildMenu(dataDir));
  mainWindow = createWindow();
  if (smokeReport) void runSmokeTest({ win: mainWindow, core, dataDir, backupRoot, reportPath: path.resolve(smokeReport) });
}

// One Billforce at a time: opening it again brings the open window to the front.
if (!smokeReport && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.on('window-all-closed', () => app.quit());
  // Finish a waiting automatic backup and close the databases cleanly.
  app.on('will-quit', () => {
    if (!core) return;
    try {
      core.finishPendingBackups();
    } catch (e) {
      console.error('Automatic backup at exit failed:', e);
    }
    core.close();
    core = null;
  });
  void app.whenReady().then(start);
}
