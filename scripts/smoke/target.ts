/**
 * Canonical target resolution for the Playwright smoke harness (ROK-1466).
 *
 * The suite can be pointed at three different deployments — the laptop dev env
 * (Vite :5173 + Nest :3000), a local allinone container, or an rl-infra fleet
 * env reachable only by its internal hostname — and before this module every
 * consumer re-derived that target from its own `process.env.X || 'http://
 * localhost:NNNN'` literal. The literals disagreed: `playwright.config.ts`
 * honoured `PLAYWRIGHT_BASE_URL`, `playwright-global-setup.ts` honoured only
 * `BASE_URL`, and four specs hardcoded their own API fallback. A fleet run
 * therefore drove the env in the browser while authenticating against a
 * localhost API that does not exist inside the runner container.
 *
 * Precedence is deliberately identical to `playwright.config.ts` and to
 * `scripts/validate-ci.sh::_resolve_web_url`, so all three agree on one host.
 */

/** Web target used when nothing is configured — the laptop Vite dev server. */
export const DEFAULT_WEB_URL = 'http://localhost:5173';

/** API target used when nothing is configured — the laptop Nest dev server. */
export const DEFAULT_API_URL = 'http://localhost:3000';

/** The subset of the environment this module reads. */
export type TargetEnv = Record<string, string | undefined>;

/** Drop trailing slashes so `${base}/path` never produces a double slash. */
function trimTrailingSlash(url: string): string {
    return url.replace(/\/+$/, '');
}

/**
 * Resolve the web (SPA) origin the browser should drive.
 *
 * @param env - Environment to read; defaults to `process.env`.
 * @returns `BASE_URL`, else `PLAYWRIGHT_BASE_URL`, else the local Vite default.
 */
export function resolveWebUrl(env: TargetEnv = process.env): string {
    return trimTrailingSlash(
        env.BASE_URL || env.PLAYWRIGHT_BASE_URL || DEFAULT_WEB_URL,
    );
}

/**
 * Whether the suite is pointed at something other than the laptop dev server.
 *
 * @param env - Environment to read; defaults to `process.env`.
 * @returns True for an allinone container or a fleet env, false for local dev.
 */
export function isRemoteTarget(env: TargetEnv = process.env): boolean {
    return resolveWebUrl(env) !== DEFAULT_WEB_URL;
}

/**
 * Resolve the API origin the harness should authenticate and seed against.
 *
 * An explicit `API_URL` always wins. Otherwise a remote target derives
 * `<web>/api` — the allinone image and every fleet env serve the SPA and the
 * API from one nginx, so the API is a path on the same origin — and a local
 * target keeps the separate `:3000` dev server.
 *
 * @param env - Environment to read; defaults to `process.env`.
 * @returns The API base URL, without a trailing slash.
 */
export function resolveApiUrl(env: TargetEnv = process.env): string {
    if (env.API_URL) return trimTrailingSlash(env.API_URL);
    if (!isRemoteTarget(env)) return DEFAULT_API_URL;
    return `${resolveWebUrl(env)}/api`;
}
