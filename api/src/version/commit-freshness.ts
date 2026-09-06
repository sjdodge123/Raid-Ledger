/**
 * Commit-freshness helpers for the version check (ROK-1393).
 *
 * Production runs the daily `main` image (ci.yml docker-build), which bakes
 * COMMIT_SHA but no APP_VERSION, so semver-vs-release comparison always read
 * api/package.json (0.1.1) and flagged every build as out of date. "Out of
 * date" now means "the running commit is more than 30 h behind origin/main".
 */

/** Daily Watchtower window (24 h) plus slack. Strictly-greater comparison. */
export const BEHIND_MAIN_THRESHOLD_MS = 30 * 60 * 60 * 1000;

export const GITHUB_REPO_URL = 'https://github.com/sjdodge123/Raid-Ledger';
export const GITHUB_COMMITS_API =
  'https://api.github.com/repos/sjdodge123/Raid-Ledger/commits';

export interface CommitInfo {
  sha: string;
  /** ISO timestamp of `commit.committer.date` (merge time for squashes). */
  date: string;
}

export type CommitFetchResult =
  | { kind: 'ok'; commit: CommitInfo }
  | { kind: 'rate-limited' }
  | { kind: 'error'; status?: number };

interface GitHubCommitBody {
  sha: string;
  commit: { committer: { date: string } };
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

/**
 * Running commit from the environment. Dockerfile.allinone defaults
 * COMMIT_SHA to '' when the build-arg is absent — treat empty/whitespace
 * as unset so the semver fallback runs instead of GET /commits/.
 */
export function readCommitSha(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.COMMIT_SHA?.trim();
  return raw ? raw : null;
}

export function isBehindMain(
  running: CommitInfo,
  main: CommitInfo,
  thresholdMs: number = BEHIND_MAIN_THRESHOLD_MS,
): boolean {
  if (running.sha === main.sha) return false;
  // NaN dates compare false, so an unparseable date never flags out-of-date.
  return Date.parse(main.date) - Date.parse(running.date) > thresholdMs;
}

export function compareUrl(runningSha: string, mainSha: string): string {
  return `${GITHUB_REPO_URL}/compare/${shortSha(runningSha)}...${shortSha(mainSha)}`;
}

export async function fetchCommit(
  ref: string,
  headers: Record<string, string>,
): Promise<CommitFetchResult> {
  try {
    const response = await fetch(`${GITHUB_COMMITS_API}/${ref}`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 403 || response.status === 429) {
      return { kind: 'rate-limited' };
    }
    if (!response.ok) return { kind: 'error', status: response.status };
    const body = (await response.json()) as GitHubCommitBody;
    const date = body?.commit?.committer?.date;
    if (typeof body?.sha !== 'string' || typeof date !== 'string') {
      return { kind: 'error' };
    }
    return { kind: 'ok', commit: { sha: body.sha, date } };
  } catch {
    return { kind: 'error' };
  }
}
