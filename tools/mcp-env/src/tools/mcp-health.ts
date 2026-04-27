import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PROJECT_DIR } from '../config.js';

export const TOOL_NAME = 'mcp_health';
export const TOOL_DESCRIPTION =
  'Diagnose the health of locally-developed MCP servers configured in .mcp.json. ' +
  'Spawns each local server with --self-check to verify its source loads cleanly. ' +
  'Third-party servers (e.g. @playwright/mcp) are reported as skipped.';

const SELF_CHECK_TIMEOUT_MS = 3_000;

type HealthStatus =
  | { status: 'healthy' }
  | { status: 'unhealthy'; error: string }
  | { status: 'skipped'; reason: string };

export interface McpHealthResult {
  servers: Record<string, HealthStatus>;
  summary: string;
}

interface McpServerEntry {
  command: string;
  args: string[];
}

interface McpJsonShape {
  mcpServers: Record<string, McpServerEntry>;
}

/** Find a local entrypoint path in args (one starting with `tools/` and ending in .ts/.js/.mjs/.cjs). */
function findLocalEntrypoint(args: string[]): string | null {
  for (const arg of args) {
    if (typeof arg !== 'string') continue;
    if (!arg.startsWith('tools/')) continue;
    if (/\.(ts|js|mjs|cjs)$/.test(arg)) return arg;
  }
  return null;
}

/** Spawn the configured command with --self-check appended; resolve with a HealthStatus. */
function probeServer(entry: McpServerEntry): Promise<HealthStatus> {
  return new Promise((resolve) => {
    const argv = [...entry.args, '--self-check'];
    let settled = false;
    const finish = (status: HealthStatus): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(status);
    };
    const timer = setTimeout(() => {
      finish({ status: 'unhealthy', error: 'timeout (3s) waiting for --self-check' });
    }, SELF_CHECK_TIMEOUT_MS);
    execFile(entry.command, argv, { timeout: SELF_CHECK_TIMEOUT_MS }, (err, _stdout, stderr) => {
      if (!err) return finish({ status: 'healthy' });
      const code = (err as NodeJS.ErrnoException & { code?: number | string }).code;
      const detail = stderr?.trim() || err.message || 'unknown error';
      finish({ status: 'unhealthy', error: `exit ${code ?? '?'}: ${detail}` });
    });
  });
}

/** Classify a single server entry and produce its HealthStatus. */
async function checkServer(entry: McpServerEntry): Promise<HealthStatus> {
  const entrypoint = findLocalEntrypoint(entry.args);
  if (!entrypoint) {
    return {
      status: 'skipped',
      reason: 'third-party server (no local tools/ entrypoint)',
    };
  }
  const absPath = join(PROJECT_DIR, entrypoint);
  try {
    await access(absPath);
  } catch {
    return {
      status: 'unhealthy',
      error: `entrypoint not found: ${entrypoint}`,
    };
  }
  return probeServer(entry);
}

/** Build the summary string from the per-server results. */
function buildSummary(servers: Record<string, HealthStatus>): string {
  let healthy = 0;
  let unhealthy = 0;
  let skipped = 0;
  for (const status of Object.values(servers)) {
    if (status.status === 'healthy') healthy++;
    else if (status.status === 'unhealthy') unhealthy++;
    else skipped++;
  }
  return `${healthy} healthy, ${unhealthy} unhealthy, ${skipped} skipped`;
}

/** Probe every server in .mcp.json and return aggregated health. */
export async function execute(): Promise<McpHealthResult> {
  const mcpJsonPath = join(PROJECT_DIR, '.mcp.json');
  const raw = await readFile(mcpJsonPath, 'utf-8');
  const parsed = JSON.parse(raw) as McpJsonShape;
  const servers: Record<string, HealthStatus> = {};
  for (const [name, entry] of Object.entries(parsed.mcpServers ?? {})) {
    servers[name] = await checkServer(entry);
  }
  return { servers, summary: buildSummary(servers) };
}
