// mcp-rl-fleet — MCP server exposing rl-infra fleet operations to agents.
//
// The server always forces RL_PROXMOX_USER=rl-agent and RL_OPERATOR=0 so
// agents can never accidentally execute as the privileged operator user.
// See ../../rl-infra/README.md for the fleet architecture.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

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

const server = new McpServer({ name: 'mcp-rl-fleet', version: '0.1.0' });

const jsonResult = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

server.tool(
  claim.TOOL_NAME,
  claim.TOOL_DESCRIPTION,
  {
    branch: z.string().optional(),
    worktree_path: z.string().optional(),
    wait: z.boolean().optional(),
    wait_timeout_seconds: z.number().int().min(5).max(3600).optional(),
    poll_interval_seconds: z.number().int().min(2).max(60).optional(),
  },
  async (p) => jsonResult(await claim.execute(p)),
);

server.tool(
  release.TOOL_NAME,
  release.TOOL_DESCRIPTION,
  { worktree_path: z.string().optional() },
  async (p) => jsonResult(await release.execute(p)),
);

server.tool(status.TOOL_NAME, status.TOOL_DESCRIPTION, {}, async () =>
  jsonResult(await status.execute()),
);

server.tool(
  envSpin.TOOL_NAME,
  envSpin.TOOL_DESCRIPTION,
  {
    slug: z
      .string()
      .regex(/^[a-z0-9-]+$/, 'slug must match [a-z0-9-]+')
      .min(1)
      .max(63),
    image: z.string().optional(),
    ttl_hours: z.number().int().min(1).max(168).optional(),
    worktree_path: z.string().optional(),
  },
  async (p) => jsonResult(await envSpin.execute(p)),
);

server.tool(
  envDestroy.TOOL_NAME,
  envDestroy.TOOL_DESCRIPTION,
  {
    slug: z.string().regex(/^[a-z0-9-]+$/, 'slug must match [a-z0-9-]+'),
    force: z.boolean().optional(),
  },
  async (p) => jsonResult(await envDestroy.execute(p)),
);

server.tool(envList.TOOL_NAME, envList.TOOL_DESCRIPTION, {}, async () =>
  jsonResult(await envList.execute()),
);

server.tool(
  runOnRunner.TOOL_NAME,
  runOnRunner.TOOL_DESCRIPTION,
  {
    command: z.string().min(1),
    worktree_path: z.string().optional(),
    timeout_seconds: z.number().int().min(1).max(7200).optional(),
  },
  async (p) => jsonResult(await runOnRunner.execute(p)),
);

server.tool(
  validateCi.TOOL_NAME,
  validateCi.TOOL_DESCRIPTION,
  {
    args: z.array(z.string()).optional(),
    worktree_path: z.string().optional(),
    against_env_slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
    timeout_seconds: z.number().int().min(60).max(7200).optional(),
  },
  async (p) => jsonResult(await validateCi.execute(p)),
);

server.tool(
  dbUrl.TOOL_NAME,
  dbUrl.TOOL_DESCRIPTION,
  { slug: z.string().regex(/^[a-z0-9-]+$/) },
  async (p) => jsonResult(await dbUrl.execute(p)),
);

server.tool(
  logsUrl.TOOL_NAME,
  logsUrl.TOOL_DESCRIPTION,
  { query: z.string().optional(), since: z.string().optional() },
  async (p) => jsonResult(await logsUrl.execute(p)),
);

server.tool(
  envSync.TOOL_NAME,
  envSync.TOOL_DESCRIPTION,
  {
    slug: z.string().regex(/^[a-z0-9-]+$/),
    mode: z.enum(['settings', 'full']).optional(),
    timeout_seconds: z.number().int().min(30).max(7200).optional(),
  },
  async (p) => jsonResult(await envSync.execute(p)),
);

server.tool(
  envCloneProd.TOOL_NAME,
  envCloneProd.TOOL_DESCRIPTION,
  {
    slug: z.string().regex(/^[a-z0-9-]+$/),
    skip_local_refresh: z.boolean().optional(),
    timeout_seconds: z.number().int().min(60).max(7200).optional(),
  },
  async (p) => jsonResult(await envCloneProd.execute(p)),
);

server.tool(
  envBuildImage.TOOL_NAME,
  envBuildImage.TOOL_DESCRIPTION,
  {
    tag: z.string().regex(/^[a-zA-Z0-9._-]+$/).min(1).max(63),
    no_push: z.boolean().optional(),
    worktree_path: z.string().optional(),
    timeout_seconds: z.number().int().min(60).max(7200).optional(),
  },
  async (p) => jsonResult(await envBuildImage.execute(p)),
);

server.tool(
  envDeploy.TOOL_NAME,
  envDeploy.TOOL_DESCRIPTION,
  {
    slug: z.string().regex(/^[a-z0-9-]+$/).min(1).max(63),
    branch: z.string().optional(),
    worktree_path: z.string().optional(),
    skip_sync: z.boolean().optional(),
    skip_build: z.boolean().optional(),
    clone_prod: z.boolean().optional(),
    clone_prod_skip_local_refresh: z.boolean().optional(),
    timeout_seconds: z.number().int().min(60).max(7200).optional(),
  },
  async (p) => jsonResult(await envDeploy.execute(p)),
);

server.tool(
  forceRelease.TOOL_NAME,
  forceRelease.TOOL_DESCRIPTION,
  {
    slot: z.number().int().min(1).max(64),
    reason: z.string().min(1).max(500),
    no_destroy: z.boolean().optional(),
  },
  async (p) => jsonResult(await forceRelease.execute(p)),
);

// ----- Test plans -----
const slugSchema = z.string().regex(/^[a-z0-9-]+$/).min(1).max(63);

server.tool(
  testPlan.CREATE_TOOL,
  testPlan.CREATE_DESC,
  {
    slug: slugSchema,
    title: z.string().max(200).optional(),
    steps: z.array(z.object({
      description: z.string().min(1).max(500),
      expected: z.string().max(500).optional(),
      category: z.string().max(50).optional(),
      test_url: z.string().url().max(500).optional(),
      reset_hint: z.string().max(300).optional(),
    })).min(1).max(100),
    replace: z.boolean().optional(),
    created_by: z.string().max(200).optional(),
  },
  async (p) => jsonResult(await testPlan.executeCreate(p)),
);

server.tool(
  testPlan.STATUS_TOOL,
  testPlan.STATUS_DESC,
  { slug: slugSchema },
  async (p) => jsonResult(await testPlan.executeStatus(p)),
);

server.tool(
  testPlan.WAIT_TOOL,
  testPlan.WAIT_DESC,
  {
    slug: slugSchema,
    timeout_seconds: z.number().int().min(5).max(3600).optional(),
  },
  async (p) => jsonResult(await testPlan.executeWait(p)),
);

server.tool(
  testPlan.CLEAR_TOOL,
  testPlan.CLEAR_DESC,
  { slug: slugSchema },
  async (p) => jsonResult(await testPlan.executeClear(p)),
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
