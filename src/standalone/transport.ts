/** Browser edition: API calls run in the page (replaces ../renderer/transport.ts in the GitHub Pages build). */
import type { ApiResult, Edition } from '../renderer/transport';

export type { ApiResult, ClientAction, Edition } from '../renderer/transport';

export const EDITION: Edition = 'browser';

export async function transport(name: string, input: unknown, token: string | null): Promise<ApiResult> {
  const { invokeLocal } = await import('./runtime');
  return invokeLocal(name, input, token);
}

export async function uploadBytes(file: File, token: string | null): Promise<ApiResult> {
  const { uploadLocal } = await import('./runtime');
  return uploadLocal(new Uint8Array(await file.arrayBuffer()), token);
}
