/**
 * Shared path constants for the Playwright auth-token cache (ROK-1085).
 *
 * `globalSetup` writes the admin JWT to `scripts/.auth/admin-token.json` and
 * the browser storageState to `scripts/.auth/admin.json` so every Playwright
 * worker can reuse them instead of POSTing /auth/local in parallel (which
 * tripped the rate limiter and caused did-not-run flakes).
 *
 * Both `playwright-global-setup.ts` and `smoke/api-helpers.ts` need to agree
 * on the exact filesystem location of the token. They used to compute it
 * independently — drift between the two paths would silently break the cache
 * (the smoke worker would see "missing" and fall back to live login).
 *
 * Importing both paths from this module guarantees they stay in lockstep.
 */
import path from 'node:path';

export const AUTH_DIR = path.resolve(__dirname, '.auth');
export const STORAGE_STATE_PATH = path.join(AUTH_DIR, 'admin.json');
export const TOKEN_FILE_PATH = path.join(AUTH_DIR, 'admin-token.json');
