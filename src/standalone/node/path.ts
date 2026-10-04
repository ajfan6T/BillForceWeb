/** Browser stand-in for node:path (POSIX paths; the browser edition keeps its files under /data). */

function normalizeParts(path: string): string {
  const absolute = path.startsWith('/');
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop();
      else if (!absolute) out.push('..');
    } else out.push(part);
  }
  const joined = out.join('/');
  return absolute ? `/${joined}` : joined || '.';
}

export const sep = '/';
export const delimiter = ':';

export function isAbsolute(p: string): boolean {
  return p.startsWith('/');
}

export function normalize(p: string): string {
  return normalizeParts(p);
}

export function join(...parts: string[]): string {
  const joined = parts.filter((p) => p !== '').join('/');
  return joined ? normalizeParts(joined) : '.';
}

export function resolve(...parts: string[]): string {
  let path = '';
  for (let i = parts.length - 1; i >= 0 && !path.startsWith('/'); i--) {
    if (parts[i]) path = path ? `${parts[i]}/${path}` : parts[i];
  }
  return normalizeParts(path.startsWith('/') ? path : `/${path}`);
}

export function dirname(p: string): string {
  const n = normalizeParts(p);
  const i = n.lastIndexOf('/');
  if (i < 0) return '.';
  return i === 0 ? '/' : n.slice(0, i);
}

export function basename(p: string, ext?: string): string {
  const base = normalizeParts(p).split('/').pop() ?? '';
  return ext && base.endsWith(ext) && base !== ext ? base.slice(0, -ext.length) : base;
}

export function extname(p: string): string {
  const base = basename(p);
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i) : '';
}

export const win32 = {
  isAbsolute: (p: string) => /^([a-zA-Z]:[\\/]|\\\\)/.test(p),
  resolve: (...parts: string[]) => resolve(...parts),
};

export const posix = { sep, delimiter, isAbsolute, normalize, join, resolve, dirname, basename, extname };

export default { ...posix, win32, posix };
