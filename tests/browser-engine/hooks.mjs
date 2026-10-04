// Module hooks: Node's built-ins used by the Billforce core resolve to the browser stand-ins.
const STAND_INS = {
  'node:sqlite': 'sqlite.ts',
  'node:fs': 'fs.ts',
  'node:fs/promises': 'fsPromises.ts',
  'node:path': 'path.ts',
  'node:os': 'os.ts',
  'node:crypto': 'crypto.ts',
};
const base = new URL('../../src/standalone/node/', import.meta.url);

export async function resolve(specifier, context, next) {
  const file = STAND_INS[specifier];
  if (file) return { url: new URL(file, base).href, shortCircuit: true };
  return next(specifier, context);
}
