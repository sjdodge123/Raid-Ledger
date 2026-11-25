import { PROJECT_DIR } from '../config.js';
import { run } from '../shell.js';

export const TOOL_NAME = 'story_status';
export const TOOL_DESCRIPTION =
  'Check delivery status of Linear stories by reconciling git branches and GitHub PRs. ' +
  'Returns branch info, merge status, and PR state for each story.';

/** Verdict for a story's delivery status. */
type Verdict = 'done' | 'in_flight' | 'not_started';

/** PR information from GitHub CLI. */
interface PrInfo {
  number: number;
  state: string;
  url: string;
}

/** Status of a single branch matching a story. */
interface BranchStatus {
  name: string;
  on_origin: true;
  merged_to_main: boolean;
  pr: PrInfo | null;
}

/** Result for a single story. */
interface StoryResult {
  branches: BranchStatus[];
  verdict: Verdict;
}

/** Full response from story_status. */
type StoryStatusResult = Record<string, StoryResult>;

/** Input parameters for the tool. */
interface StoryStatusParams {
  stories: string[];
}

/** Run `git fetch origin` and throw if it fails. */
async function fetchOrigin(): Promise<void> {
  const result = await run('git', ['-C', PROJECT_DIR, 'fetch', 'origin'], 30_000);
  if (result.exitCode !== 0) {
    throw new Error(
      `git fetch origin failed (exit ${result.exitCode}): ${result.stderr}`,
    );
  }
}

/** Get all remote branch names from `git branch -r`. */
async function getRemoteBranches(): Promise<string[]> {
  const result = await run('git', ['-C', PROJECT_DIR, 'branch', '-r']);
  if (result.exitCode !== 0) return [];
  return parseBranchOutput(result.stdout);
}

/** Get remote branches merged to origin/main. */
async function getMergedBranches(): Promise<Set<string>> {
  const result = await run('git', [
    '-C',
    PROJECT_DIR,
    'branch',
    '-r',
    '--merged',
    'origin/main',
  ]);
  if (result.exitCode !== 0) return new Set();
  return new Set(parseBranchOutput(result.stdout));
}

/** Parse branch output lines into trimmed branch names. */
function parseBranchOutput(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.includes('->'));
}

/**
 * Extract numeric ID from a story identifier.
 * Accepts "ROK-867" or just "867".
 */
function extractNumericId(storyId: string): string {
  const match = storyId.match(/(\d+)$/);
  return match?.[1] ?? storyId;
}

/** Normalize story identifier to uppercase ROK-XXX format. */
function normalizeStoryId(storyId: string): string {
  const num = extractNumericId(storyId);
  return `ROK-${num}`;
}

/**
 * Find remote branches matching a story's numeric ID.
 * Uses word-boundary-safe regex: rok-{num}(-|$)
 */
function findMatchingBranches(
  numericId: string,
  allBranches: string[],
): string[] {
  const pattern = new RegExp(`rok-${numericId}(-|$)`, 'i');
  return allBranches.filter((branch) => {
    const name = stripOriginPrefix(branch);
    return pattern.test(name);
  });
}

/** Strip "origin/" prefix from a branch ref. */
function stripOriginPrefix(branch: string): string {
  return branch.replace(/^origin\//, '');
}

/**
 * Branch names we will hand to `gh`. A pushed branch name is attacker-
 * controlled, so anything outside this set (shell metacharacters, a leading
 * `-` that gh would read as a flag) is never passed on.
 */
const SAFE_BRANCH_NAME = /^[A-Za-z0-9._/][A-Za-z0-9._/-]*$/;

/** True when `name` is safe to pass to gh as a branch argument. */
export function isSafeBranchName(name: string): boolean {
  return SAFE_BRANCH_NAME.test(name);
}

/** Lazily resolve (once per call) the origin URL that `gh --repo` needs. */
function originUrlResolver(): () => Promise<string> {
  let pending: Promise<string> | null = null;
  return () => {
    pending ??= run('git', ['-C', PROJECT_DIR, 'remote', 'get-url', 'origin']).then(
      (r) => {
        if (r.exitCode !== 0 || r.stdout.length === 0) {
          throw new Error(
            `git remote get-url origin failed (exit ${r.exitCode}): ${r.stderr}`,
          );
        }
        return r.stdout;
      },
    );
    return pending;
  };
}

/** Query GitHub CLI for PR info on a branch. Throws on gh failure. */
async function getPrInfo(
  branch: string,
  getRepoUrl: () => Promise<string>,
): Promise<PrInfo | null> {
  const branchName = stripOriginPrefix(branch);
  if (!isSafeBranchName(branchName)) return null;
  const repoUrl = await getRepoUrl();
  const result = await run(
    'gh',
    ['pr', 'list', '--repo', repoUrl, '--head', branchName, '--state', 'all', '--json', 'number,state,url'],
    15_000,
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `gh CLI failed for branch ${branchName} (exit ${result.exitCode}): ${result.stderr}`,
    );
  }
  return parseFirstPr(result.stdout);
}

/** Parse the first PR from gh JSON output. */
function parseFirstPr(stdout: string): PrInfo | null {
  const prs: PrInfo[] = JSON.parse(stdout || '[]');
  const [first] = prs;
  if (first === undefined) return null;
  return { number: first.number, state: first.state, url: first.url };
}

/** Check a single branch: merge status and PR info. */
async function checkBranch(
  branch: string,
  mergedSet: Set<string>,
  getRepoUrl: () => Promise<string>,
): Promise<BranchStatus> {
  const merged = mergedSet.has(branch);
  const pr = await getPrInfo(branch, getRepoUrl);
  return {
    name: stripOriginPrefix(branch),
    on_origin: true,
    merged_to_main: merged,
    pr,
  };
}

/** Derive verdict from branch statuses. */
function deriveVerdict(branches: BranchStatus[]): Verdict {
  if (branches.length === 0) return 'not_started';
  const anyMerged = branches.some(
    (b) => b.merged_to_main || b.pr?.state === 'MERGED',
  );
  return anyMerged ? 'done' : 'in_flight';
}

/** Process a single story: find branches, check status, derive verdict. */
async function processStory(
  storyId: string,
  allBranches: string[],
  mergedSet: Set<string>,
  getRepoUrl: () => Promise<string>,
): Promise<[string, StoryResult]> {
  const normalized = normalizeStoryId(storyId);
  const numericId = extractNumericId(storyId);
  const matched = findMatchingBranches(numericId, allBranches);
  const branches = await Promise.all(
    matched.map((b) => checkBranch(b, mergedSet, getRepoUrl)),
  );
  return [normalized, { branches, verdict: deriveVerdict(branches) }];
}

/**
 * Execute the story_status tool.
 * Fetches from origin, finds matching branches, and checks PR status for each story.
 */
export async function execute(
  params: StoryStatusParams,
): Promise<StoryStatusResult> {
  await fetchOrigin();
  const [allBranches, mergedSet] = await Promise.all([
    getRemoteBranches(),
    getMergedBranches(),
  ]);
  const getRepoUrl = originUrlResolver();
  const entries = await Promise.all(
    params.stories.map((s) => processStory(s, allBranches, mergedSet, getRepoUrl)),
  );
  return Object.fromEntries(entries);
}
