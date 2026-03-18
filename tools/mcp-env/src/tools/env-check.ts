import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROJECT_DIR, IS_WORKTREE, MAIN_REPO } from '../config.js';
import { ENV_FILES, parseVarNames } from '../env-locations.js';

export const TOOL_NAME = 'env_check';
export const TOOL_DESCRIPTION =
  'Check all known .env files: existence, missing required vars, worktree status. Never exposes secret values.';

/** Status of a single .env file. */
interface EnvFileStatus {
  path: string;
  exists: boolean;
  exampleExists: boolean;
  missingVars: string[];
  presentVars: string[];
  description: string;
}

/** Full response from env_check. */
interface EnvCheckResult {
  projectDir: string;
  isWorktree: boolean;
  mainRepo: string | null;
  files: EnvFileStatus[];
  summary: string;
}

/** Check a single .env file entry and return its status. */
function checkSingleFile(entry: typeof ENV_FILES[number]): EnvFileStatus {
  const fullPath = resolve(PROJECT_DIR, entry.relativePath);
  const examplePath = resolve(PROJECT_DIR, entry.examplePath);
  const exists = existsSync(fullPath);
  const exampleExists = existsSync(examplePath);

  let presentVars: string[] = [];
  let missingVars: string[] = [];

  if (exists) {
    const content = readFileSync(fullPath, 'utf-8');
    presentVars = parseVarNames(content);
    missingVars = entry.requiredVars.filter((v) => !presentVars.includes(v));
  } else {
    missingVars = [...entry.requiredVars];
  }

  return {
    path: entry.relativePath,
    exists,
    exampleExists,
    missingVars,
    presentVars,
    description: entry.description,
  };
}

/** Build summary string from file statuses. */
function buildSummary(files: EnvFileStatus[]): string {
  const present = files.filter((f) => f.exists).length;
  const missing = files.length - present;
  return `${files.length} env files checked: ${present} present, ${missing} missing`;
}

/** Execute the env_check tool. */
export async function execute(): Promise<EnvCheckResult> {
  const files = ENV_FILES.map(checkSingleFile);
  return {
    projectDir: PROJECT_DIR,
    isWorktree: IS_WORKTREE,
    mainRepo: MAIN_REPO,
    files,
    summary: buildSummary(files),
  };
}
