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
 *
 * ROK-1286: the anchor is `process.cwd()`, NOT `__dirname`. Playwright's
 * transpile loader rewrites this file into a per-invocation temp directory, so
 * `__dirname` resolved to a transient path that differed between
 * `playwright-global-setup.ts` (which writes the token) and
 * `smoke/api-helpers.ts` (which reads it). The reader would see "missing" and
 * fall back to a live `/auth/local` login — the rate-limited fan-out that
 * ROK-1085 introduced this cache to avoid. On the fleet's one-way Mutagen
 * replica the temp `.auth` dir was also deleted mid-run, producing ENOENT on
 * write. `process.cwd()` is the repo root for every `npx playwright test`
 * invocation and matches `playwright.config.ts`'s
 * `path.resolve('scripts/.auth/admin.json')` storageState anchor exactly, so
 * setup, the workers, and the config all resolve the same real directory.
 */
import path from 'node:path';

export const AUTH_DIR = path.resolve(process.cwd(), 'scripts/.auth');
export const STORAGE_STATE_PATH = path.join(AUTH_DIR, 'admin.json');
export const TOKEN_FILE_PATH = path.join(AUTH_DIR, 'admin-token.json');
