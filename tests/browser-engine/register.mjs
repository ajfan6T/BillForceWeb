// Runs the test suite on the browser edition's engine (npm run test:browser-engine):
// SQLite through sql.js, files in memory, crypto in JavaScript - exactly what runs on GitHub Pages.
import { register } from 'node:module';

register('./hooks.mjs', import.meta.url);
process.env.BILLFORCE_TEST_ENGINE = 'browser';

const { setSqlJs } = await import('../../src/standalone/node/sqlite.ts');
const initSqlJs = (await import('sql.js')).default;
setSqlJs(await initSqlJs());
