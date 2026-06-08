// ROK-1362 — runner slot resolution + git re-scaffold, extracted from
// validate-ci.ts so that file stays under the 300-line cap and these helpers
// are independently testable + reusable (rl_run_on_runner's >120s task-route
// reuses resolveSlot for the --slot watchdog flag).

import { execFile, execFileSync } from 'node:child_process';
import { shellQuote } from '../exec.js';

export function execFileP(
  cmd: string,
  args: string[],
  opts: { timeout?: number; maxBuffer?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, opts, (err, stdout, stderr) => {
      const out =
        typeof stdout === 'string' ? stdout : (stdout as unknown as Buffer | undefined)?.toString() ?? '';
      const errStr =
        typeof stderr === 'string' ? stderr : (stderr as unknown as Buffer | undefined)?.toString() ?? '';
      if (err) {
        const e = err as Error & { stdout?: string; stderr?: string; code?: number };
        e.stdout = out;
        e.stderr = errStr || e.stderr || '';
        reject(e);
        return;
      }
      resolve({ stdout: out, stderr: errStr });
    });
  });
}

interface RlStatusSlot {
  slot: number;
  claimed_by?: string | null;
  branch?: string | null;
}
interface RlStatusResponse {
  slots?: RlStatusSlot[];
}

/**
 * Resolve the slot the calling agent holds via `rl status --json` (a pure read).
 * Prefer the slot whose claimed_by matches agentId; else fall back to the first
 * claimed slot (covers test mocks + future claimed_by shape changes).
 */
export async function resolveSlot(
  sshUser: string,
  sshHost: string,
  agentId: string,
): Promise<number | null> {
  try {
    const { stdout } = await execFileP(
      'ssh',
      [
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=5',
        `${sshUser}@${sshHost}`,
        `/srv/rl-infra/orchestrator/bin/rl status --json`,
      ],
      { timeout: 15_000, maxBuffer: 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout.trim()) as RlStatusResponse;
    const slots = parsed.slots ?? [];
    const match = slots.find((s) => s.claimed_by === agentId);
    if (match) return match.slot;
    const claimed = slots.find((s) => s.claimed_by);
    return claimed ? claimed.slot : null;
  } catch {
    return null;
  }
}

/**
 * Bug R defensive re-scaffold. Probes the runner's /workspace/.git/objects; if
 * missing, rebuilds it from the laptop-side origin + branch (falling back to
 * main). Non-fatal — every failure path is swallowed.
 */
export async function ensureRunnerGit(
  sshUser: string,
  sshHost: string,
  agentId: string,
  worktreePath: string | undefined,
): Promise<void> {
  const slot = await resolveSlot(sshUser, sshHost, agentId);
  if (slot === null) return;

  const container = `rl-runner-${slot}`;
  try {
    await execFileP(
      'ssh',
      [
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=5',
        `${sshUser}@${sshHost}`,
        `docker exec ${container} test -d /workspace/.git/objects`,
      ],
      { timeout: 10_000 },
    );
    return;
  } catch {
    // missing — fall through to scaffold
  }

  const cwd = worktreePath ?? process.cwd();
  let originUrl: string;
  let branch: string;
  try {
    originUrl = execFileSync('git', ['-C', cwd, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5_000,
    }).trim();
  } catch {
    return;
  }
  if (!originUrl) return;
  try {
    branch = execFileSync('git', ['-C', cwd, 'branch', '--show-current'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5_000,
    }).trim();
  } catch {
    branch = '';
  }
  if (!branch) branch = 'main';

  const script =
    `set -e; cd /workspace; rm -rf .git; git init -q; ` +
    `git remote add origin ${shellQuote(originUrl)}; ` +
    `git fetch origin ${shellQuote(branch)} --depth=500 -q || ` +
    `git fetch origin main --depth=500 -q; ` +
    `git reset --mixed FETCH_HEAD; ` +
    `git checkout -q -B ${shellQuote(branch)} 2>/dev/null || true`;
  await execFileP(
    'ssh',
    [
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      `${sshUser}@${sshHost}`,
      `docker exec -i ${container} bash -c ${shellQuote(script)}`,
    ],
    { timeout: 60_000 },
  ).catch(() => {
    /* non-fatal */
  });
}
