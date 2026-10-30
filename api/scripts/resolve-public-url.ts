/**
 * ROK-1697: print the platform public URL for shell callers (the allinone
 * entrypoint), using the same resolver the API logs at boot.
 *
 *   node dist/scripts/resolve-public-url.js
 *
 * Contract:
 * - Resolved   → prints the URL (no trailing slash) plus a newline on stdout,
 *                exits 0.
 * - Unresolved → prints nothing on stdout, exits 0. Callers test for an
 *                empty string, so `URL=$(node …)` is safe under `set -e`.
 * - A set-but-unusable source (not http(s)) → one warning line on stderr per
 *                source; resolution falls through to the next source.
 * - Any non-zero exit means the script itself is broken (missing build,
 *                crash), never "unresolved".
 *
 * Reads deployer-controlled env only — `PUBLIC_URL`, `RENDER_EXTERNAL_URL`,
 * `RAILWAY_PUBLIC_DOMAIN`, `FLY_APP_NAME`, `APP_URL`,
 * `HEROKU_APP_DEFAULT_DOMAIN_NAME` — in that order.
 *
 * No Sentry instrumentation (CLAUDE.md boot-script rule): this is a pure env
 * read with no I/O that can fail meaningfully; a crash surfaces as a non-zero
 * exit to the calling shell.
 */
import { resolvePlatformPublicUrl } from '../src/settings/client-url.helpers';

const resolved = resolvePlatformPublicUrl(process.env, (message) => {
  process.stderr.write(`resolve-public-url: ${message}\n`);
});
if (resolved) process.stdout.write(`${resolved.url}\n`);
