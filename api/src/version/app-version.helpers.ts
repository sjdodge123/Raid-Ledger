import { readFileSync } from 'fs';
import { join } from 'path';
import { normalizeVersion } from './release-check';

/**
 * The running instance's version (ROK-1676 AC 7, shared with
 * `VersionCheckService`). Prefers `APP_VERSION`, baked into the image at
 * build time from the git release tag, so it can't drift the way a
 * hand-maintained package.json field can; falls back to package.json for
 * local dev.
 */
export function resolveAppVersion(
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (env.APP_VERSION) return normalizeVersion(env.APP_VERSION);
  const pkg = JSON.parse(
    readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
  ) as { version: string };
  return pkg.version;
}
