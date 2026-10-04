/** How API calls reach the Billforce server: HTTP. The GitHub Pages build swaps in ../standalone/transport.ts. */
import type { SerializedError } from '../core/errors';

/** What the browser must do after a call: print a receipt / report, or download a file. */
export type ClientAction = { type: 'print'; html: string; paperWidthMm?: number; copies?: number } | { type: 'download'; url: string; fileName: string };

export type ApiResult = ({ ok: true; data: unknown } | { ok: false; error: SerializedError }) & { actions?: ClientAction[] };

/** False here; true in the browser edition, where the data lives in this browser. */
export const STANDALONE = false;

export async function transport(name: string, input: unknown, token: string | null): Promise<ApiResult> {
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

/** Send a backup file to restore; returns { uploadId }. */
export async function uploadBytes(file: File, token: string | null): Promise<ApiResult> {
  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: file,
  });
  try {
    return (await res.json()) as ApiResult;
  } catch {
    return { ok: false, error: { code: 'VALIDATION', message: res.status === 413 ? 'The file is too large to upload.' : `Upload failed (HTTP ${res.status}).` } };
  }
}
