import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PROJECT_DIR, IS_WORKTREE, MAIN_REPO } from '../config.js';
import { ENV_FILES } from '../env-locations.js';

export const TOOL_NAME = 'env_copy';
export const TOOL_DESCRIPTION =
  'Copy .env files from the main repo into this worktree. Skips files that already exist (never overwrites).';

/** Copy status for a single file. */
type CopyStatus = 'copied' | 'skipped_exists' | 'skipped_no_source';

interface CopyEntry {
  path: string;
  status: CopyStatus;
}

interface EnvCopyResult {
  isWorktree: boolean;
  mainRepo: string | null;
  copied: CopyEntry[];
  summary: string;
}

/** List of valid .env file paths for error messages. */
const VALID_PATHS = ENV_FILES.map((f) => f.relativePath);

/** Copy a single .env file from main repo to worktree. */
function copySingleFile(relativePath: string): CopyEntry {
  const dest = resolve(PROJECT_DIR, relativePath);
  if (existsSync(dest)) {
    return { path: relativePath, status: 'skipped_exists' };
  }

  const source = resolve(MAIN_REPO!, relativePath);
  if (!existsSync(source)) {
    return { path: relativePath, status: 'skipped_no_source' };
  }

  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(source, dest);
  return { path: relativePath, status: 'copied' };
}

/** Build summary string from copy results. */
function buildCopySummary(entries: CopyEntry[]): string {
  const copied = entries.filter((e) => e.status === 'copied').length;
  const skipped = entries.length - copied;
  return `Copied ${copied} file${copied !== 1 ? 's' : ''}, skipped ${skipped}`;
}

/** Execute the env_copy tool. */
export async function execute(
  params: { file?: string; all?: boolean },
): Promise<EnvCopyResult | { error: string }> {
  if (!IS_WORKTREE) {
    return {
      isWorktree: false,
      mainRepo: null,
      copied: [],
      summary: 'Not in a worktree. Nothing to copy.',
    };
  }

  if (params.file) {
    if (!VALID_PATHS.includes(params.file)) {
      return {
        error: `Unknown env file: "${params.file}". Valid paths: ${VALID_PATHS.join(', ')}`,
      };
    }
    const entry = copySingleFile(params.file);
    return {
      isWorktree: true,
      mainRepo: MAIN_REPO,
      copied: [entry],
      summary: buildCopySummary([entry]),
    };
  }

  // Default: copy all missing files
  const entries = VALID_PATHS.map(copySingleFile);
  return {
    isWorktree: true,
    mainRepo: MAIN_REPO,
    copied: entries,
    summary: buildCopySummary(entries),
  };
}
