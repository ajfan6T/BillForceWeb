/**
 * The only door between the Billforce screens and the engine in the app: window.billforce.
 * The page gets no Node or file access of its own (see src/desktop/transport.ts for the other side).
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('billforce', {
  invoke: (name: string, input: unknown, token: string | null) => ipcRenderer.invoke('billforce:invoke', name, input, token),
  upload: (data: Uint8Array, token: string | null) => ipcRenderer.invoke('billforce:upload', data, token),
});
