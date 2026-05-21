// mcp-rl-fleet — MCP server exposing rl-infra fleet operations to agents.
//
// The server always forces RL_PROXMOX_USER=rl-agent and RL_OPERATOR=0 so
// agents can never accidentally execute as the privileged operator user.
// See ../../rl-infra/README.md for the fleet architecture.
//
// TS2589 mitigation (ROK-1331 M2): Each tool's param shape is assigned to
// a typed `Record<string, z.ZodTypeAny>` const before being passed to
// server.tool(). This short-circuits the SDK's deep inference of nested
// `.regex().min().max().optional()` chains via `ShapeOutput<Args>` that
// otherwise produces TS2589 ("Type instantiation is excessively deep").

// eslint-disable-next-line max-lines
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { worktreePathSchema } from './exec.js';
import * as claim from './tools/claim.js';
import * as release from './tools/release.js';
import * as status from './tools/status.js';
import * as envSpin from './tools/env-spin.js';
import * as envDestroy from './tools/env-destroy.js';
import * as envList from './tools/env-list.js';
import * as runOnRunner from './tools/run-on-runner.js';
import * as validateCi from './tools/validate-ci.js';
import * as dbUrl from './tools/db-url.js';
import * as logsUrl from './tools/logs-url.js';
import * as envSync from './tools/env-sync.js';
import * as envCloneProd from './tools/env-clone-prod.js';
import * as envBuildImage from './tools/env-build-image.js';
import * as envDeploy from './tools/env-deploy.js';
import * as forceRelease from './tools/force-release.js';
import * as testPlan from './tools/test-plan.js';
import * as task from './tools/task.js';
import * as taskInspect from './tools/task-inspect.js';
import * as infraLogs from './tools/infra-logs.js';
import * as lease from './tools/lease.js';
import * as fleetHealth from './tools/fleet-health.js';

// 0.4.0 — ROK-1331 M7: rl_fleet_health agent-side monitor tool.
// 0.3.0 — ROK-1331 M5a: lease queue + claim duration + pin/unpin.
const server = new McpServer({ name: 'mcp-rl-fleet', version: '0.4.0' });

const jsonResult = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

type Shape = Record<string, z.ZodTypeAny>;

/**
 * Wrapper for server.tool that boxes the schema argument as `any` so the SDK's
 * `Args extends ZodRawShapeCompat` generic doesn't deeply infer each schema's
 * output type. Without this, TS2589 ("Type instantiation is excessively deep")
 * fires on tool registrations whose param shape contains many nested
 * `.regex().min().max().optional()` chains. The runtime cost is nil — the SDK
 * still validates via the schema at call time.
 */
const registerTool = (
  name: string,
  description: string,
  paramsSchema: Shape,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cb: (p: any) => Promise<{ content: Array<{ type: 'text'; text: string }> }>,
): void => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server.tool as any)(name, description, paramsSchema, cb);
};

// Shared zod fragments (declared once to keep deep inference bounded).
const slugSchema = z
  .string()
  .regex(/^[a-z0-9-]+$/, 'slug must match [a-z0-9-]+')
  .min(1)
  .max(63);
const taskIdSchema = z.string().regex(/^[a-z0-9]{8,32}$/);
const waitFragment: Shape = {
  wait: z.boolean().optional(),
  wait_timeout_seconds: z.number().int().min(5).max(3600).default(1800),
};

const claimSchema: Shape = {
  branch: z.string().optional(),
  worktree_path: worktreePathSchema,
  wait: z.boolean().optional(),
  wait_timeout_seconds: z.number().int().min(5).max(3600).optional(),
  poll_interval_seconds: z.number().int().min(2).max(60).optional(),
};
registerTool(claim.TOOL_NAME, claim.TOOL_DESCRIPTION, claimSchema, async (p) =>
  jsonResult(await claim.execute(p as claim.ClaimParams)),
);

const releaseSchema: Shape = {
  worktree_path: worktreePathSchema,
  // ROK-1331 M5a — preserve_envs defaults to true for agents (the wrapper's
  // .execute() applies the default). Pass false to force the legacy destroy
  // path (operator behavior).
  preserve_envs: z.boolean().optional(),
};
registerTool(release.TOOL_NAME, release.TOOL_DESCRIPTION, releaseSchema, async (p) =>
  jsonResult(await release.execute(p as release.ReleaseParams)),
);

registerTool(status.TOOL_NAME, status.TOOL_DESCRIPTION, {} as Shape, async () =>
  jsonResult(await status.execute()),
);

const envSpinSchema: Shape = {
  slug: slugSchema,
  image: z.string().optional(),
  ttl_hours: z.number().int().min(1).max(168).optional(),
  worktree_path: worktreePathSchema,
};
registerTool(envSpin.TOOL_NAME, envSpin.TOOL_DESCRIPTION, envSpinSchema, async (p) =>
  jsonResult(await envSpin.execute(p as envSpin.EnvSpinParams)),
);

const envDestroySchema: Shape = {
  slug: slugSchema,
  force: z.boolean().optional(),
  worktree_path: worktreePathSchema,
};
registerTool(envDestroy.TOOL_NAME, envDestroy.TOOL_DESCRIPTION, envDestroySchema, async (p) =>
  jsonResult(await envDestroy.execute(p as envDestroy.EnvDestroyParams)),
);

registerTool(envList.TOOL_NAME, envList.TOOL_DESCRIPTION, {} as Shape, async () =>
  jsonResult(await envList.execute()),
);

const runOnRunnerSchema: Shape = {
  command: z.string().min(1),
  worktree_path: worktreePathSchema,
  timeout_seconds: z.number().int().min(1).max(7200).optional(),
};
registerTool(runOnRunner.TOOL_NAME, runOnRunner.TOOL_DESCRIPTION, runOnRunnerSchema, async (p) =>
  jsonResult(await runOnRunner.execute(p as runOnRunner.RunOnRunnerParams)),
);

const validateCiSchema: Shape = {
  args: z.array(z.string()).optional(),
  worktree_path: worktreePathSchema,
  against_env_slug: slugSchema.optional(),
  timeout_seconds: z.number().int().min(60).max(7200).optional(),
  ...waitFragment,
};
registerTool(validateCi.TOOL_NAME, validateCi.TOOL_DESCRIPTION, validateCiSchema, async (p) =>
  jsonResult(await validateCi.execute(p as validateCi.ValidateCiParams)),
);

const dbUrlSchema: Shape = { slug: slugSchema };
registerTool(dbUrl.TOOL_NAME, dbUrl.TOOL_DESCRIPTION, dbUrlSchema, async (p) =>
  jsonResult(await dbUrl.execute(p as dbUrl.DbUrlParams)),
);

const logsUrlSchema: Shape = {
  query: z.string().optional(),
  since: z.string().optional(),
};
registerTool(logsUrl.TOOL_NAME, logsUrl.TOOL_DESCRIPTION, logsUrlSchema, async (p) =>
  jsonResult(await logsUrl.execute(p as logsUrl.LogsUrlParams)),
);

const envSyncSchema: Shape = {
  slug: slugSchema,
  mode: z.enum(['settings', 'full']).optional(),
  timeout_seconds: z.number().int().min(30).max(7200).optional(),
};
registerTool(envSync.TOOL_NAME, envSync.TOOL_DESCRIPTION, envSyncSchema, async (p) =>
  jsonResult(await envSync.execute(p as envSync.EnvSyncParams)),
);

const envCloneProdSchema: Shape = {
  slug: slugSchema,
  skip_local_refresh: z.boolean().optional(),
  timeout_seconds: z.number().int().min(60).max(7200).optional(),
  ...waitFragment,
};
registerTool(envCloneProd.TOOL_NAME, envCloneProd.TOOL_DESCRIPTION, envCloneProdSchema, async (p) =>
  jsonResult(await envCloneProd.execute(p as envCloneProd.EnvCloneProdParams)),
);

const envBuildImageSchema: Shape = {
  tag: z.string().regex(/^[a-zA-Z0-9._-]+$/).min(1).max(63),
  no_push: z.boolean().optional(),
  worktree_path: worktreePathSchema,
  timeout_seconds: z.number().int().min(60).max(7200).optional(),
  ...waitFragment,
};
registerTool(envBuildImage.TOOL_NAME, envBuildImage.TOOL_DESCRIPTION, envBuildImageSchema, async (p) =>
  jsonResult(await envBuildImage.execute(p as envBuildImage.BuildImageParams)),
);

const envDeploySchema: Shape = {
  slug: slugSchema,
  branch: z.string().optional(),
  worktree_path: worktreePathSchema,
  skip_sync: z.boolean().optional(),
  skip_build: z.boolean().optional(),
  clone_prod: z.boolean().optional(),
  clone_prod_skip_local_refresh: z.boolean().optional(),
  timeout_seconds: z.number().int().min(60).max(7200).optional(),
};
registerTool(envDeploy.TOOL_NAME, envDeploy.TOOL_DESCRIPTION, envDeploySchema, async (p) =>
  jsonResult(await envDeploy.execute(p as envDeploy.EnvDeployParams)),
);

const forceReleaseSchema: Shape = {
  slot: z.number().int().min(1).max(64),
  reason: z.string().min(1).max(500),
  no_destroy: z.boolean().optional(),
};
registerTool(forceRelease.TOOL_NAME, forceRelease.TOOL_DESCRIPTION, forceReleaseSchema, async (p) =>
  jsonResult(await forceRelease.execute(p as forceRelease.ForceReleaseParams)),
);

// ----- Test plans -----
// ROK-1337 — plan_id is minted server-side (mcp-tool-side) with format
// `YYYY-MM-DD-HHmm-XXXX` (UTC, 4 hex). Status/wait/clear take an OPTIONAL
// plan_id to scope to a single plan; without it they target the slug as a
// whole (list / aggregate-wait / wipe-the-directory).
const planIdSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}-\d{4}-[0-9a-f]{4}$/, {
    message: 'plan_id must match YYYY-MM-DD-HHmm-XXXX (e.g. 2026-05-21-1530-7f3a)',
  });

const testPlanCreateSchema: Shape = {
  slug: slugSchema,
  // 3-7 words. We split on whitespace, count non-empty tokens, and reject
  // anything outside [3, 7]. Caller-visible error message lives in test-plan.ts
  // as defense-in-depth — the Zod boundary just gates the shape.
  goal: z.string().min(1).max(120).refine(
    (s) => {
      const n = s.trim().split(/\s+/).filter(Boolean).length;
      return n >= 3 && n <= 7;
    },
    { message: 'goal must be 3-7 words (e.g. "Validate Discord OAuth flow")' },
  ),
  // Linear story ID — renders as a deep-link chip on the dashboard.
  story_id: z.string().regex(/^ROK-\d+$/, {
    message: 'story_id must match /^ROK-\\d+$/ (e.g. "ROK-1331")',
  }),
  title: z.string().max(200).optional(),
  steps: z
    .array(
      z.object({
        description: z.string().min(1).max(500),
        expected: z.string().max(500).optional(),
        category: z.string().max(50).optional(),
        test_url: z.string().url().max(500).optional(),
        reset_hint: z.string().max(300).optional(),
      }),
    )
    .min(1)
    .max(100),
  created_by: z.string().max(200).optional(),
};
registerTool(testPlan.CREATE_TOOL, testPlan.CREATE_DESC, testPlanCreateSchema, async (p) =>
  jsonResult(await testPlan.executeCreate(p as Parameters<typeof testPlan.executeCreate>[0])),
);

const testPlanStatusSchema: Shape = {
  slug: slugSchema,
  plan_id: planIdSchema.optional(),
};
registerTool(testPlan.STATUS_TOOL, testPlan.STATUS_DESC, testPlanStatusSchema, async (p) =>
  jsonResult(await testPlan.executeStatus(p as Parameters<typeof testPlan.executeStatus>[0])),
);

const testPlanWaitSchema: Shape = {
  slug: slugSchema,
  plan_id: planIdSchema.optional(),
  timeout_seconds: z.number().int().min(5).max(3600).optional(),
};
registerTool(testPlan.WAIT_TOOL, testPlan.WAIT_DESC, testPlanWaitSchema, async (p) =>
  jsonResult(await testPlan.executeWait(p as Parameters<typeof testPlan.executeWait>[0])),
);

const testPlanClearSchema: Shape = {
  slug: slugSchema,
  plan_id: planIdSchema.optional(),
};
registerTool(testPlan.CLEAR_TOOL, testPlan.CLEAR_DESC, testPlanClearSchema, async (p) =>
  jsonResult(await testPlan.executeClear(p as Parameters<typeof testPlan.executeClear>[0])),
);

// ----- Task tools (ROK-1331 M2) -----
const TASK_STATUS_DESC =
  "Read the current state of a task spawned by rl_validate_ci, rl_env_build_image_from_runner, or rl_env_clone_prod in async (wait:false) mode. Cheap (single VM file read). Returns TaskStatusResult: steps[] from PASS/FAIL parsing, log_tail (last 50KB by default, configurable up to 1MB via log_tail_bytes), and separate script_exit_code vs mcp_runtime_status. Use rl_task_wait for push-notify shape.";
const taskStatusSchema: Shape = {
  task_id: taskIdSchema,
  log_tail_bytes: z.number().int().min(0).max(1048576).optional(),
};
registerTool('rl_task_status', TASK_STATUS_DESC, taskStatusSchema, async (p) =>
  jsonResult(await task.executeStatus(p as task.ExecuteStatusParams)),
);

const TASK_WAIT_DESC =
  "Long-poll via SSH inotifywait on the task's JSON file. Blocks until the task transitions to a terminal state OR the timeout expires (default 600s). Returns the same shape as rl_task_status on transition; returns {ok:false, error:'timed_out', task_id, waited_seconds} on timeout (resume polling via rl_task_status or another rl_task_wait). Returns {ok:false, error:'inotifywait_not_installed'} when the VM doesn't have inotify-tools.";
const taskWaitSchema: Shape = {
  task_id: taskIdSchema,
  timeout_seconds: z.number().int().min(5).max(3600).optional(),
  log_tail_bytes: z.number().int().min(0).max(1048576).optional(),
};
registerTool('rl_task_wait', TASK_WAIT_DESC, taskWaitSchema, async (p) =>
  jsonResult(await task.executeWait(p as task.ExecuteWaitParams)),
);

const TASK_CANCEL_DESC =
  "Signal a running task to exit gracefully (SIGTERM, fallback SIGKILL after 10s on the orchestrator side). Updates task JSON to mcp_runtime_status='cancelled'. Idempotent: returns ok:true even if the task already finished. `reason` is recorded in the task JSON for audit.";
const taskCancelSchema: Shape = {
  task_id: taskIdSchema,
  reason: z.string().min(1).max(500),
};
registerTool('rl_task_cancel', TASK_CANCEL_DESC, taskCancelSchema, async (p) =>
  jsonResult(await task.executeCancel(p as task.ExecuteCancelParams)),
);

const TASK_LIST_DESC =
  "List recent tasks across all slots (paginated). For triage when an agent forgets a task_id OR for the fleet dashboard. Filter by slot or mcp_runtime_status. Returns an array of TaskStatusResult-shaped objects (without log_tail) sorted by started_at descending.";
const taskListSchema: Shape = {
  slot: z.number().int().min(1).max(64).optional(),
  status: z
    .enum([
      'running',
      'succeeded',
      'failed',
      'killed_buffer_overflow',
      'killed_timeout',
      'cancelled',
    ])
    .optional(),
  limit: z.number().int().min(1).max(200).optional(),
};
registerTool('rl_task_list', TASK_LIST_DESC, taskListSchema, async (p) =>
  jsonResult(await task.executeList(p as task.ExecuteListParams)),
);

// ----- Task inspect (ROK-1338 PR-1) -----
const taskInspectSchema: Shape = { task_id: taskIdSchema };
registerTool(
  taskInspect.TOOL_NAME,
  taskInspect.TOOL_DESCRIPTION,
  taskInspectSchema,
  async (p) => jsonResult(await taskInspect.execute(p as taskInspect.ExecuteInspectParams)),
);

// ----- Infra logs (ROK-1338 PR-1) -----
const infraLogsSchema: Shape = {
  service: infraLogs.InfraServiceSchema,
  tail: z.number().int().positive().max(5000).optional(),
};
registerTool(
  infraLogs.TOOL_NAME,
  infraLogs.TOOL_DESCRIPTION,
  infraLogsSchema,
  async (p) => jsonResult(await infraLogs.execute(p as infraLogs.InfraLogsParams)),
);

// ----- Lease tools (ROK-1331 M5a) -----
const leaseStatusSchema: Shape = {
  slot: z.number().int().positive().optional(),
};
registerTool(lease.STATUS_TOOL, lease.STATUS_DESC, leaseStatusSchema, async (p) =>
  jsonResult(await lease.executeStatus(p as lease.LeaseStatusParams)),
);

const claimWaitSchema: Shape = {
  timeout_seconds: z.number().int().min(5).max(3600).optional(),
  worktree_path: worktreePathSchema,
};
registerTool(lease.WAIT_TOOL, lease.WAIT_DESC, claimWaitSchema, async (p) =>
  jsonResult(await lease.executeWait(p as lease.ClaimWaitParams)),
);

const extendSchema: Shape = {
  hours: z.number().int().min(1).max(24).optional(),
  worktree_path: worktreePathSchema,
};
registerTool(lease.EXTEND_TOOL, lease.EXTEND_DESC, extendSchema, async (p) =>
  jsonResult(await lease.executeExtend(p as lease.ExtendParams)),
);

const envPinSchema: Shape = {
  slug: slugSchema,
  worktree_path: worktreePathSchema,
};
registerTool(lease.PIN_TOOL, lease.PIN_DESC, envPinSchema, async (p) =>
  jsonResult(await lease.executePin(p as lease.PinParams)),
);
registerTool(lease.UNPIN_TOOL, lease.UNPIN_DESC, envPinSchema, async (p) =>
  jsonResult(await lease.executeUnpin(p as lease.PinParams)),
);

// ----- Fleet health (ROK-1331 M7) -----
const fleetHealthSchema: Shape = {
  severity_threshold: z.enum(['warn', 'error']).optional(),
};
registerTool(fleetHealth.TOOL_NAME, fleetHealth.TOOL_DESC, fleetHealthSchema, async (p) =>
  jsonResult(await fleetHealth.execute(p as fleetHealth.FleetHealthParams)),
);

// CLI self-check: invoking with --self-check prints OK and exits 0 if the
// imports + tool registrations didn't throw. Used by the mcp-env::mcp_health
// tool to confirm this server can start.
if (process.argv.includes('--self-check')) {
  // eslint-disable-next-line no-console
  console.log('mcp-rl-fleet OK');
  process.exit(0);
}

const transport = new StdioServerTransport();
await server.connect(transport);
