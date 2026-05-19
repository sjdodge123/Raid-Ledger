// rl_test_plan_* — agent-posted test checklist tied to a fleet env slug.
//
// Agent posts a structured checklist via rl_test_plan_create after deploying
// an env. The dashboard at fleet.gamernight.net renders it on the env card
// (operator/external testers tap pass/fail/skip). Sequential ordering is
// enforced by the dashboard server (also by the UI). Verdicts are an enum;
// tester names are sanitized — no free-form tester text reaches the agent
// (avoids LLM-injection from external-network testers; see operator
// rationale 2026-05-18).
//
// Three tools:
//   rl_test_plan_create  — post (or replace) a plan for a slug
//   rl_test_plan_status  — read current state + per-step verdicts
//   rl_test_plan_wait    — long-poll: blocks until a verdict changes or timeout
//   rl_test_plan_clear   — delete the plan (auto-fires on rl_env_destroy)

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// The dashboard is reachable internally on the VM at rl-dashboard:8080
// (Docker DNS on rl-net), but the MCP server runs on the laptop and can
// only SSH to the VM, then curl from there. Using curl-on-VM keeps the
// implementation simple and avoids opening any inbound dashboard ports.
const RUN_ON_VM_TIMEOUT_MS = 30_000;

const sshUser = () => process.env.RL_PROXMOX_USER ?? 'rl-agent';
const sshHost = () => process.env.RL_PROXMOX_HOST ?? 'rl-infra';

// Internal dashboard URL the VM can reach without going through Cloudflare.
// rl-dashboard is the container name on rl-net; rl-agent's SSH session can
// hit it via Docker DNS once a small helper container or curl is run on
// the rl-net network. Simpler: just hit the dashboard's host port. The
// dashboard exposes 8080 inside the network; let's curl through the
// docker-proxy by network-attaching curl. Actually simplest of all:
// publish nothing; the dashboard is reachable through the host on
// 127.0.0.1:* via the Traefik wildcard route. But there's no host port
// mapping. We use `docker run --rm --network rl-net curlimages/curl ...`
// to talk to it. That avoids exposing the dashboard on the host.
const curlOnVM = async (
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> => {
  const bodyArgs = body !== undefined
    ? `-H 'content-type: application/json' -d ${shellQuote(JSON.stringify(body))}`
    : '';
  // Use a one-shot curl container on rl-net so we can talk to rl-dashboard
  // by service name without exposing it on the host or going through
  // Cloudflare. -s suppresses progress, -o /dev/stderr puts the body on
  // stderr so we can capture status separately, -w prints the status.
  const remote =
    `docker run --rm --network rl-net curlimages/curl:8.10.1 ` +
    `curl -s -X ${method} ${bodyArgs} ` +
    `-w '\\nRL_STATUS:%{http_code}' ` +
    `http://rl-dashboard:8080${path}`;
  const { stdout } = await execFileAsync(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', `${sshUser()}@${sshHost()}`,
     `DOCKER_HOST=tcp://127.0.0.1:2375 ${remote}`],
    { timeout: RUN_ON_VM_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
  );
  const match = stdout.match(/\nRL_STATUS:(\d+)\s*$/);
  const status = match ? parseInt(match[1], 10) : 0;
  const rawBody = match ? stdout.slice(0, match.index ?? 0) : stdout;
  let parsed: unknown;
  try { parsed = JSON.parse(rawBody); } catch { parsed = rawBody; }
  return { status, body: parsed };
};

// Single-quote-safe shell escaper for the curl payload.
const shellQuote = (s: string) => `'${s.replace(/'/g, "'\"'\"'")}'`;

// ----- rl_test_plan_create -----
export const CREATE_TOOL = 'rl_test_plan_create';
export const CREATE_DESC =
  "Post a test checklist tied to a fleet env slug. Steps render on the fleet.gamernight.net dashboard with pass/fail/skip buttons (and optional ↗ deep link + ↻ reset button per step) for the operator + external testers to tap. Ordering is enforced sequentially. WRITE SMALL, ACTIONABLE STEPS the user can perform in seconds — bad: 'Verify the lineups page works'. Good: 'Open /lineups → Common Ground tab, expect ≥3 themed rows'. Each step SHOULD include a `test_url` deep-linking to the right view (construct from the env_url returned by rl_env_deploy) and SHOULD include a `reset_hint` if the step mutates state that may need clearing for a re-test (e.g. 'Refresh seed data via /admin/seed-lineups'). When tester taps ↻ reset, agent gets a pending_resets signal via rl_test_plan_status / rl_test_plan_wait — execute the documented reset (the hint tells YOU what to do too), then post a verdict to clear the reset state. By default refuses to overwrite existing plan; pass replace=true to clobber. Auto-cleared on rl_env_destroy.";

export interface CreatePlanStep {
  description: string;
  expected?: string;
  category?: string;
  /**
   * Deep link to the test scenario. The dashboard renders this as a "↗"
   * link next to the step so the tester can jump straight to the right
   * place (e.g. https://<slug>test.gamernight.net/lineups#common-ground).
   * MUST start with http:// or https://. Construct using the env_url
   * returned by rl_env_deploy.
   */
  test_url?: string;
  /**
   * Free-form hint shown to the tester as a tooltip on the reset button
   * — e.g. "Refresh seed data via /admin/seed-lineups". Presence of
   * reset_hint is what causes the reset button to render. Omit for
   * stateless steps that don't need a reset path.
   */
  reset_hint?: string;
}
export interface CreatePlanParams {
  slug: string;
  steps: CreatePlanStep[];
  title?: string;
  replace?: boolean;
  /** Forwarded to the server as created_by — operator can see which agent posted. */
  created_by?: string;
}

export async function executeCreate(p: CreatePlanParams) {
  if (!p.steps || p.steps.length === 0) {
    return { ok: false, error: 'steps[] required' };
  }
  try {
    const { status, body } = await curlOnVM('POST', `/api/test-plans/${p.slug}`, {
      title: p.title,
      steps: p.steps,
      replace: p.replace ?? false,
      created_by: p.created_by ?? `${process.env.USER ?? 'agent'}-mcp`,
    });
    if (status >= 200 && status < 300) {
      const publicDomain = process.env.RL_PUBLIC_DOMAIN ?? 'gamernight.net';
      return {
        ok: true,
        ...(body as object),
        dashboard_url: `https://fleet.${publicDomain}`,
        env_url: `https://${p.slug}test.${publicDomain}`,
      };
    }
    return { ok: false, error: 'http_status_' + status, body };
  } catch (err) {
    const e = err as Error;
    return { ok: false, error: 'curl_failed', message: e.message };
  }
}

// ----- rl_test_plan_status -----
export const STATUS_TOOL = 'rl_test_plan_status';
export const STATUS_DESC =
  "Read the current state of a fleet test plan: per-step verdicts (pass/fail/skip/pending), tester names, timestamps, and an aggregate summary (counts per state, last_updated_at). Returns 404-shape if no plan exists for the slug. Cheap to call — read-only filesystem access on the VM.";

export async function executeStatus(p: { slug: string }) {
  try {
    const { status, body } = await curlOnVM('GET', `/api/test-plans/${p.slug}`);
    if (status === 404) return { ok: false, error: 'no_plan_for_slug', slug: p.slug };
    if (status >= 200 && status < 300) return body;
    return { ok: false, error: 'http_status_' + status, body };
  } catch (err) {
    const e = err as Error;
    return { ok: false, error: 'curl_failed', message: e.message };
  }
}

// ----- rl_test_plan_wait -----
export const WAIT_TOOL = 'rl_test_plan_wait';
export const WAIT_DESC =
  "Long-poll: block until a tester records a verdict on any step of the plan, or until timeout. Implemented via inotifywait on the plan's JSON file on the VM (push-like UX without exposing the laptop). Returns the same shape as rl_test_plan_status when a change is detected, or {timed_out: true} after timeout. Typical pattern: agent calls this in a loop after rl_test_plan_create, reacts to verdicts as they come in. Default timeout 600s (10 min).";

export async function executeWait(p: { slug: string; timeout_seconds?: number }) {
  const timeoutS = Math.max(5, Math.min(3600, p.timeout_seconds ?? 600));
  // inotifywait blocks until the file is modified or its timeout fires.
  // We then call status. The wait runs inside a curl-container-style
  // exec on the VM — actually we need a shell on the VM with inotifywait.
  // inotify-tools is installed on the VM host (rl-infra/SETUP.md), so
  // ssh + inotifywait directly works. Exit 0 = event; 1 = timeout (or
  // missing file); 2 = error. Use timeout-friendly bash.
  const remote =
    `inotifywait -e modify -e move -e create -t ${timeoutS} ` +
    `/srv/rl-infra/state/test-plans/${p.slug}.json 2>/dev/null; ` +
    `echo RL_INOTIFY_EXIT:$?`;
  try {
    const { stdout } = await execFileAsync(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', `${sshUser()}@${sshHost()}`, remote],
      { timeout: (timeoutS + 30) * 1000, maxBuffer: 1024 * 1024 },
    );
    const m = stdout.match(/RL_INOTIFY_EXIT:(\d+)/);
    const code = m ? parseInt(m[1], 10) : -1;
    if (code === 2) {
      // inotifywait exit 2 = timeout. Return the timed_out shape so
      // the agent can loop without ambiguity.
      return { ok: true, timed_out: true, waited_seconds: timeoutS };
    }
    if (code !== 0) {
      // Could be missing file (plan was cleared) or inotify error.
      // Fall through to a status read so the agent gets the current shape.
    }
  } catch (err) {
    const e = err as Error;
    return { ok: false, error: 'wait_failed', message: e.message };
  }
  // Event fired — return the updated status.
  return executeStatus({ slug: p.slug });
}

// ----- rl_test_plan_clear -----
export const CLEAR_TOOL = 'rl_test_plan_clear';
export const CLEAR_DESC =
  "Delete the test plan for a slug. Idempotent — returns ok=true even if no plan exists. rl_env_destroy also calls this automatically as cleanup. Useful when the agent wants to start a fresh plan after a major redesign.";

export async function executeClear(p: { slug: string }) {
  try {
    const { status, body } = await curlOnVM('DELETE', `/api/test-plans/${p.slug}`);
    if (status >= 200 && status < 300) return body;
    return { ok: false, error: 'http_status_' + status, body };
  } catch (err) {
    const e = err as Error;
    return { ok: false, error: 'curl_failed', message: e.message };
  }
}
