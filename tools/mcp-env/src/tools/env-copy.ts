import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PROJECT_DIR, IS_WORKTREE, MAIN_REPO } from '../config.js';
import { ENV_FILES } from '../env-locations.js';

export const TOOL_NAME = 'env_copy';
export const TOOL_DESCRIPTION =
  'Copy .env files from the main repo into this worktree. Skips files that already exist (never overwrites). Propagates DEMO_MODE from the main repo root .env to the worktree api/.env so smoke tests and manual runs inherit auth-bypass.';

/** Copy status for a single file. */
type CopyStatus = 'copied' | 'skipped_exists' | 'skipped_no_source';

/** Overlay status when propagating DEMO_MODE into api/.env. */
type OverlayStatus = 'applied' | 'already_present' | 'no_source_value' | 'no_dest_file';

interface CopyEntry {
  path: string;
  status: CopyStatus;
  /** Present only for api/.env entries. */
  demoModeOverlay?: OverlayStatus;
}

interface EnvCopyResult {
  isWorktree: boolean;
  mainRepo: string | null;
  copied: CopyEntry[];
  summary: string;
}

/** List of valid .env file paths for error messages. */
const VALID_PATHS = ENV_FILES.map((f) => f.relativePath);

/** Read the DEMO_MODE assignment line from the main repo's root .env, if present. */
function readDemoModeFromMainRoot(): string | null {
  if (!MAIN_REPO) return null;
  const rootEnv = resolve(MAIN_REPO, '.env');
  if (!existsSync(rootEnv)) return null;
  const content = readFileSync(rootEnv, 'utf-8');
  // Match the last DEMO_MODE= assignment, ignoring `export` prefix and surrounding whitespace.
  const matches = [...content.matchAll(/^\s*(?:export\s+)?DEMO_MODE=(.*)$/gm)];
  if (matches.length === 0) return null;
  const value = matches[matches.length - 1][1].trim();
  return `DEMO_MODE=${value}`;
}

/**
 * Propagate DEMO_MODE from main repo root .env into a worktree's api/.env.
 * Idempotent: appends only if DEMO_MODE is not already present in the destination.
 */
export function propagateDemoMode(destApiEnvPath: string): OverlayStatus {
  const demoLine = readDemoModeFromMainRoot();
  if (!demoLine) return 'no_source_value';
  if (!existsSync(destApiEnvPath)) return 'no_dest_file';

  const current = readFileSync(destApiEnvPath, 'utf-8');
  if (/^\s*(?:export\s+)?DEMO_MODE=/m.test(current)) {
    return 'already_present';
  }
  const prefix = current.length > 0 && !current.endsWith('\n') ? '\n' : '';
  appendFileSync(destApiEnvPath, `${prefix}${demoLine}\n`);
  return 'applied';
}

/** Copy a single .env file from main repo to worktree. */
function copySingleFile(relativePath: string): CopyEntry {
  const dest = resolve(PROJECT_DIR, relativePath);
  let status: CopyStatus;
  if (existsSync(dest)) {
    status = 'skipped_exists';
  } else {
    const source = resolve(MAIN_REPO!, relativePath);
    if (!existsSync(source)) {
      return { path: relativePath, status: 'skipped_no_source' };
    }
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(source, dest);
    status = 'copied';
  }

  const entry: CopyEntry = { path: relativePath, status };
  if (relativePath === 'api/.env') {
    entry.demoModeOverlay = propagateDemoMode(dest);
  }
  return entry;
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
