/**
 * Browser stand-in for node:fs: an in-memory file system. Files under /data are
 * saved to IndexedDB by ../storage.ts (it listens to every change here), so the
 * unchanged Billforce core can keep its databases, backups and registry as files.
 */
import { dirname, resolve } from './path';

interface Entry {
  data: Uint8Array;
  mtimeMs: number;
}

const files = new Map<string, Entry>();
const dirs = new Set<string>(['/']);
type Listener = (path: string, data: Uint8Array | null) => void;
const listeners = new Set<Listener>();

const abs = (p: string) => resolve(String(p));

function fsError(code: 'ENOENT' | 'EEXIST' | 'EISDIR', syscall: string, p: string): Error {
  const e = new Error(`${code}: ${code === 'ENOENT' ? 'no such file or directory' : code === 'EEXIST' ? 'file already exists' : 'is a directory'}, ${syscall} '${p}'`) as Error & {
    code: string;
  };
  e.code = code;
  return e;
}

function addDirs(dir: string): void {
  for (let d = dir; !dirs.has(d); d = dirname(d)) dirs.add(d);
}

function setFile(p: string, data: Uint8Array, notify = true): void {
  addDirs(dirname(p));
  files.set(p, { data, mtimeMs: Date.now() });
  if (notify) for (const fn of listeners) fn(p, data);
}

function deleteFile(p: string): void {
  if (!files.delete(p)) return;
  for (const fn of listeners) fn(p, null);
}

/** Called for every file written, renamed or removed (data null = removed). */
export function onFileChange(fn: Listener): void {
  listeners.add(fn);
}

/** Put a file saved earlier back in place at start-up (no change is reported). */
export function loadFile(p: string, data: Uint8Array, mtimeMs: number): void {
  const a = abs(p);
  addDirs(dirname(a));
  files.set(a, { data, mtimeMs });
}

export function existsSync(p: string): boolean {
  const a = abs(p);
  return files.has(a) || dirs.has(a);
}

export function mkdirSync(p: string, _opts?: { recursive?: boolean }): void {
  addDirs(abs(p));
}

export function readFileSync(p: string, encoding?: BufferEncoding | { encoding?: string | null } | null): Uint8Array | string {
  const a = abs(p);
  const f = files.get(a);
  if (!f) throw fsError(dirs.has(a) ? 'EISDIR' : 'ENOENT', 'open', a);
  const enc = typeof encoding === 'string' ? encoding : encoding?.encoding;
  return enc ? new TextDecoder().decode(f.data) : f.data.slice();
}

export function writeFileSync(p: string, data: string | Uint8Array, _encoding?: unknown): void {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  setFile(abs(p), bytes);
}

export function copyFileSync(from: string, to: string): void {
  const f = files.get(abs(from));
  if (!f) throw fsError('ENOENT', 'copyfile', abs(from));
  setFile(abs(to), f.data.slice());
}

export function renameSync(from: string, to: string): void {
  const a = abs(from);
  const f = files.get(a);
  if (!f) throw fsError('ENOENT', 'rename', a);
  deleteFile(a);
  setFile(abs(to), f.data);
}

export function rmSync(p: string, opts?: { force?: boolean; recursive?: boolean }): void {
  const a = abs(p);
  if (files.has(a)) {
    deleteFile(a);
    return;
  }
  if (dirs.has(a)) {
    if (!opts?.recursive) throw fsError('EISDIR', 'rm', a);
    const prefix = a === '/' ? '/' : `${a}/`;
    for (const f of [...files.keys()]) if (f.startsWith(prefix)) deleteFile(f);
    for (const d of [...dirs]) if (d === a || d.startsWith(prefix)) dirs.delete(d);
    dirs.add('/');
    return;
  }
  if (!opts?.force) throw fsError('ENOENT', 'rm', a);
}

export function readdirSync(p: string): string[] {
  const a = abs(p);
  if (!dirs.has(a)) throw fsError('ENOENT', 'scandir', a);
  const prefix = a === '/' ? '/' : `${a}/`;
  const names = new Set<string>();
  for (const f of files.keys()) if (f.startsWith(prefix)) names.add(f.slice(prefix.length).split('/')[0]);
  for (const d of dirs) if (d.startsWith(prefix) && d !== a) names.add(d.slice(prefix.length).split('/')[0]);
  return [...names].sort();
}

export function statSync(p: string) {
  const a = abs(p);
  const f = files.get(a);
  if (!f && !dirs.has(a)) throw fsError('ENOENT', 'stat', a);
  const mtimeMs = f?.mtimeMs ?? Date.now();
  return { size: f?.data.byteLength ?? 0, mtimeMs, mtime: new Date(mtimeMs), isFile: () => !!f, isDirectory: () => !f };
}

let tempCounter = 0;
export function mkdtempSync(prefix: string): string {
  const dir = `${prefix}${Date.now().toString(36)}${(tempCounter++).toString(36)}`;
  addDirs(abs(dir));
  return dir;
}

// File handles are only used to flush a file to disk: nothing to do in memory.
export function openSync(_p: string, _flags?: string): number {
  return 3;
}
export function fsyncSync(_fd: number): void {}
export function closeSync(_fd: number): void {}

export default {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  renameSync,
  rmSync,
  readdirSync,
  statSync,
  mkdtempSync,
  openSync,
  fsyncSync,
  closeSync,
};
