/**
 * Feature-level half of the version check (ROK-294, ROK-1475): the latest
 * GitHub release vs the running APP_VERSION. Extracted from
 * VersionCheckService so the service can run the build-level half beside it.
 */
const RELEASES_API =
  'https://api.github.com/repos/sjdodge123/Raid-Ledger/releases/latest';
const TAGS_API =
  'https://api.github.com/repos/sjdodge123/Raid-Ledger/tags?per_page=1';

export interface LatestRelease {
  version: string;
  htmlUrl: string | null;
}

interface GitHubRelease {
  tag_name: string;
  html_url: string;
}

type WarnLogger = { warn: (message: string, ...rest: unknown[]) => void };

/** Strip a leading 'v' from version strings for comparison. */
export function normalizeVersion(version: string): string {
  return version.replace(/^v/i, '');
}

/** Simple semver comparison: true when remote > local. */
export function isNewer(remote: string, local: string): boolean {
  const remoteParts = remote.split('.').map(Number);
  const localParts = local.split('.').map(Number);
  for (let i = 0; i < Math.max(remoteParts.length, localParts.length); i++) {
    const r = remoteParts[i] ?? 0;
    const l = localParts[i] ?? 0;
    if (r > l) return true;
    if (r < l) return false;
  }
  return false;
}

/** Latest GitHub release, falling back to the latest tag on 404. */
export async function fetchLatestRelease(
  headers: Record<string, string>,
  logger: WarnLogger,
): Promise<LatestRelease | null> {
  try {
    const response = await fetch(RELEASES_API, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) {
      const body = (await response.json()) as GitHubRelease;
      return {
        version: normalizeVersion(body.tag_name),
        htmlUrl: body.html_url ?? null,
      };
    }
    if (response.status === 404) return fetchLatestTag(headers);
    if (response.status === 403 || response.status === 429) {
      logger.warn('GitHub API rate limited, skipping version check');
      return null;
    }
    logger.warn(`GitHub releases API returned ${response.status}`);
    return null;
  } catch (error) {
    logger.warn(
      'Failed to reach GitHub API:',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * Fallback when no releases exist. Tags have no per-release html_url, so
 * `htmlUrl` is null and the UI falls back to the generic /releases index.
 */
async function fetchLatestTag(
  headers: Record<string, string>,
): Promise<LatestRelease | null> {
  try {
    const response = await fetch(TAGS_API, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const tags = (await response.json()) as Array<{ name: string }>;
    if (tags.length === 0) return null;
    return { version: normalizeVersion(tags[0].name), htmlUrl: null };
  } catch {
    return null;
  }
}
