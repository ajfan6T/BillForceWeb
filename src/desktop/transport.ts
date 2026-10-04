/** Windows app: API calls go to the Billforce engine in the app itself (replaces ../renderer/transport.ts in the desktop build). */
import type { ApiResult, Edition } from '../renderer/transport';

export type { ApiResult, ClientAction, Edition } from '../renderer/transport';

export const EDITION: Edition = 'desktop';

/** Set up by electron/preload.ts. */
interface DesktopBridge {
  invoke(name: string, input: unknown, token: string | null): Promise<ApiResult>;
  upload(data: Uint8Array, token: string | null): Promise<ApiResult>;
}

const bridge = (globalThis as { billforce?: DesktopBridge }).billforce;

const NOT_STARTED: ApiResult = { ok: false, error: { code: 'INTERNAL', message: 'BILLFORCE did not start properly. Close it and open it again.' } };

function failed(e: unknown): ApiResult {
  return { ok: false, error: { code: 'INTERNAL', message: (e as Error)?.message ?? String(e) } };
}

export async function transport(name: string, input: unknown, token: string | null): Promise<ApiResult> {
  if (!bridge) return NOT_STARTED;
  try {
    return await bridge.invoke(name, input, token);
  } catch (e) {
    return failed(e);
  }
}

/** Hand a backup file chosen on this computer to Billforce (to restore it). */
export async function uploadBytes(file: File, token: string | null): Promise<ApiResult> {
  if (!bridge) return NOT_STARTED;
  try {
    return await bridge.upload(new Uint8Array(await file.arrayBuffer()), token);
  } catch (e) {
    return failed(e);
  }
}
