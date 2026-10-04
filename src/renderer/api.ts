/**
 * Typed client for the core API, with the session token of this browser.
 * Types come straight from the core route definitions, so a wrong route name
 * or input shape is a compile error. Calls go to the server over HTTP, or run in
 * the page in the browser edition ("@transport" is swapped by the build).
 */
import { transport, uploadBytes, EDITION, type ClientAction } from '@transport';
import type { ApiInput, ApiOutput, RouteName } from '../core/api/routes';
import type { SerializedError } from '../core/errors';
import type { ExportFormat, ReportData } from '../shared/report';
import { downloadInBrowser, printInBrowser } from './browserActions';

export type { RouteName, ApiInput, ApiOutput };

/** True in the browser edition (GitHub Pages): the data lives in this browser only. */
export const BROWSER_EDITION = EDITION === 'browser';

/** True in the Windows app: the data and backups are files on this computer; printing goes straight to the printer. */
export const DESKTOP = EDITION === 'desktop';

const TOKEN_KEY = 'bf:session-token';

export function sessionToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setSessionToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: the session lasts until the page is closed */
  }
}

const LAST_BUSINESS_KEY = 'bf:last-business';

/** The business last signed in to on this computer (filled in on the login screen). */
export function lastBusinessName(): string {
  try {
    return localStorage.getItem(LAST_BUSINESS_KEY) ?? '';
  } catch {
    return '';
  }
}

export function rememberBusinessName(name: string): void {
  try {
    if (name.trim()) localStorage.setItem(LAST_BUSINESS_KEY, name.trim());
  } catch {
    /* private mode */
  }
}

export class ApiError extends Error {
  code: SerializedError['code'];
  fields?: Record<string, string>;
  constructor(err: SerializedError) {
    super(err.message);
    this.code = err.code;
    this.fields = err.fields;
  }
}

function runActions(actions: ClientAction[] | undefined): void {
  for (const a of actions ?? []) {
    if (a.type === 'download') downloadInBrowser(a.url, a.fileName);
    else if (a.type === 'print') printInBrowser(a.html, a.copies);
  }
}

const listeners = new Set<(name: string) => void>();

/** Subscribe to successful API calls (used to refresh data after changes). */
export function onApiCall(fn: (name: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function call<K extends RouteName>(name: K, ...args: ApiInput<K> extends void ? [] | [undefined] : [ApiInput<K>]): Promise<ApiOutput<K>> {
  const result = await transport(name, args[0], sessionToken());
  if (!result.ok) {
    if (result.error.code === 'UNAUTHENTICATED' && name !== 'auth.login') {
      setSessionToken(null);
      window.dispatchEvent(new CustomEvent('billforce:unauthenticated'));
    }
    throw new ApiError(result.error);
  }
  runActions(result.actions);
  for (const fn of listeners) fn(name);
  return result.data as ApiOutput<K>;
}

/** Send a file (a backup to restore) to Billforce; returns its upload id. */
export async function uploadFile(file: File): Promise<string> {
  const result = await uploadBytes(file, sessionToken());
  if (!result.ok) throw new ApiError(result.error);
  return (result.data as { uploadId: string }).uploadId;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Export a report (the browser downloads it); returns what to tell the user, or null if nothing happened. */
export async function exportReport(report: ReportData, format: ExportFormat): Promise<string | null> {
  const res = await call('files.exportReport', { report, format });
  if (res.printed) return 'In the print window, choose "Save as PDF" to keep a PDF copy.';
  if (!res.path) return null;
  return DESKTOP ? `Saved ${res.path}` : `Downloaded ${res.path}`;
}
