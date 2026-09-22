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
export function readCommitSha(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
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

export const GITHUB_COMPARE_API =
  'https://api.github.com/repos/sjdodge123/Raid-Ledger/compare';

/**
 * ROK-1475 (OQ-5, operator ruling 2026-09-22): "N fixes available" counts
 * `fix:`-class commits only. Matched on each message's FIRST line and not
 * anchored to `^`, and a type joined by ` + ` counts, so the two-type
 * squash subject `fix(events) + feat(lfg-board): …` is a fix. `fixed`, `fixup` and
 * `prefix:` do not.
 */
const FIX_SUBJECT_RE = /(^|[^A-Za-z0-9])fix(\([^)]+\))?!?(:|\s+\+)/;

export function countFixCommits(messages: string[]): number {
  return messages.filter((m) => FIX_SUBJECT_RE.test(m.split('\n', 1)[0]))
    .length;
}

export interface CompareInfo {
  /** Commits on `head` that `base` lacks — exact even when truncated. */
  aheadBy: number;
  /** `fix:` commits in the returned span (a lower bound when truncated). */
  fixCount: number;
  /** GitHub caps `commits[]` at 250; true when the span was longer. */
  truncated: boolean;
}

export type CompareFetchResult =
  | { kind: 'ok'; compare: CompareInfo }
  | { kind: 'rate-limited' }
  | { kind: 'error'; status?: number };

interface GitHubCompareBody {
  ahead_by?: unknown;
  commits?: Array<{ commit?: { message?: unknown } }>;
}

function toCompareInfo(body: GitHubCompareBody): CompareInfo | null {
  if (typeof body?.ahead_by !== 'number' || !Array.isArray(body.commits)) {
    return null;
  }
  const messages = body.commits.map((c) =>
    typeof c?.commit?.message === 'string' ? c.commit.message : '',
  );
  return {
    aheadBy: body.ahead_by,
    fixCount: countFixCommits(messages),
    truncated: messages.length < body.ahead_by,
  };
}

/** GET /compare/<base>...<head> — what `head` has that `base` lacks. */
export async function fetchCompare(
  base: string,
  head: string,
  headers: Record<string, string>,
): Promise<CompareFetchResult> {
  try {
    const response = await fetch(`${GITHUB_COMPARE_API}/${base}...${head}`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 403 || response.status === 429) {
      return { kind: 'rate-limited' };
    }
    if (!response.ok) return { kind: 'error', status: response.status };
    const compare = toCompareInfo((await response.json()) as GitHubCompareBody);
    return compare ? { kind: 'ok', compare } : { kind: 'error' };
  } catch {
    return { kind: 'error' };
  }
}
