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
 * setup, the workers, and the config all resolve the same real directory. *
 * ROK-1466: the cwd anchor is still right, but it is not SUFFICIENT on an
 * rl-infra runner. The Mutagen session is `mode: one-way-replica` with the
 * laptop as the sole source of truth, so ANY file the runner creates inside
 * the synced tree that does not exist on the laptop is deleted on the next
 * sync cycle (~30s). Global setup would write `scripts/.auth/admin.json`,
 * Mutagen would reap it mid-run, and the first spec failed with
 * `Error reading storage state from /workspace/scripts/.auth/admin.json:
 * ENOENT` even though setup had just logged a successful write. The auth dir
 * therefore has to live OUTSIDE the synced tree on a runner.
 *
 * Two layers, belt and braces:
 *   1. `PLAYWRIGHT_AUTH_DIR` — an explicit override. `validate-ci.sh` exports
 *      a per-run `/tmp/rl-playwright-auth-$$` for fleet e2e runs.
 *   2. This module's own fallback, so a bare `npx playwright test` on a runner
 *      (no validate-ci in the loop) is safe too. It must be DETERMINISTIC —
 *      global setup and each worker are separate processes and all three have
 *      to resolve the same directory, so no pid or randomness here.
 */
import path from 'node:path';

/** Repo root inside an rl-infra runner container. */
export const RUNNER_WORKSPACE = '/workspace';

/** Out-of-tree auth dir used on a runner, where the tree is Mutagen-reaped. */
export const RUNNER_AUTH_DIR = '/tmp/rl-playwright-auth';

/**
 * Resolve the directory holding the Playwright auth artifacts.
 *
 * @param env - Environment to read; defaults to `process.env`.
 * @param cwd - Working directory; defaults to `process.cwd()`.
 * @returns An absolute path, identical across every process in one run.
 */
export function resolveAuthDir(
    env: Record<string, string | undefined> = process.env,
    cwd: string = process.cwd(),
): string {
    const override = env.PLAYWRIGHT_AUTH_DIR?.trim();
    if (override) return path.resolve(override);
    if (cwd === RUNNER_WORKSPACE || cwd.startsWith(`${RUNNER_WORKSPACE}${path.sep}`)) {
        return RUNNER_AUTH_DIR;
    }
    return path.resolve(cwd, 'scripts/.auth');
}

export const AUTH_DIR = resolveAuthDir();
export const STORAGE_STATE_PATH = path.join(AUTH_DIR, 'admin.json');
export const TOKEN_FILE_PATH = path.join(AUTH_DIR, 'admin-token.json');
