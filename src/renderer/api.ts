/**
 * Typed client for the core API (HTTP, with the session token of this browser).
 * Types come straight from the core route definitions, so a wrong route name
 * or input shape is a compile error.
 */
import type { ApiInput, ApiOutput, RouteName } from '../core/api/routes';
import type { SerializedError } from '../core/errors';
import type { ExportFormat, ReportData } from '../shared/report';

export type { RouteName, ApiInput, ApiOutput };

/** What the browser must do after a call: print a receipt / report, or download a file. */
type ClientAction = { type: 'print'; html: string; paperWidthMm?: number; copies?: number } | { type: 'download'; url: string; fileName: string };

type ApiResult = ({ ok: true; data: unknown } | { ok: false; error: SerializedError }) & { actions?: ClientAction[] };

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

export class ApiError extends Error {
  code: SerializedError['code'];
  fields?: Record<string, string>;
  constructor(err: SerializedError) {
    super(err.message);
    this.code = err.code;
    this.fields = err.fields;
  }
}

async function transport(name: string, input: unknown): Promise<ApiResult> {
  const token = sessionToken();
  let res: Response;
  try {
    res = await fetch('/api/invoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ name, input }),
    });
  } catch {
    return { ok: false, error: { code: 'INTERNAL', message: 'Cannot reach the Billforce server. Check your internet connection and try again.' } };
  }
  try {
    return (await res.json()) as ApiResult;
  } catch {
    return { ok: false, error: { code: 'INTERNAL', message: `The server did not answer properly (HTTP ${res.status}). Please try again.` } };
  }
}

/** Print HTML (a receipt or report) with the browser's print dialog, from a hidden frame. */
function printInBrowser(html: string, copies = 1): void {
  const frame = document.createElement('iframe');
  // No scripts run inside; same-origin lets this page start printing it.
  frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  frame.onload = () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    if (!win || !doc) return;
    if (copies > 1) doc.body.innerHTML = Array.from({ length: copies }, () => doc.body.innerHTML).join('<div style="break-after: page"></div>');
    win.focus();
    win.print();
    setTimeout(() => frame.remove(), 60_000);
  };
  frame.srcdoc = html;
  document.body.appendChild(frame);
}

function downloadInBrowser(url: string, fileName: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
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
  const result = await transport(name, args[0]);
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

/** Send a file (a backup to restore) to the server; returns its upload id. */
export async function uploadFile(file: File): Promise<string> {
  const token = sessionToken();
  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: file,
  });
  let result: ApiResult;
  try {
    result = (await res.json()) as ApiResult;
  } catch {
    throw new ApiError({ code: 'VALIDATION', message: res.status === 413 ? 'The file is too large to upload.' : `Upload failed (HTTP ${res.status}).` });
  }
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
  return res.path ? `Downloaded ${res.path}` : null;
}
