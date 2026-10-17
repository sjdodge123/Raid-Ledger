import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as envCheck from './tools/env-check.js';
import * as envCopy from './tools/env-copy.js';
import * as envLock from './tools/env-lock.js';
import * as mcpHealth from './tools/mcp-health.js';
import * as serviceStatus from './tools/service-status.js';
import * as storyStatus from './tools/story-status.js';

/** Wrap an arbitrary tool result as a single pretty-printed JSON text content item. */
function jsonText(result: unknown): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

/** Zod shape for the env-lock acquire tool (hoisted to keep its registrar small). */
const ACQUIRE_SCHEMA = {
  branch: z.string().optional(),
  worktree: z.string().optional(),
  purpose: z.string(),
  pid: z.number().int().nonnegative().optional(),
  ttl_minutes: z.number().int().positive().optional(),
  priority: z.enum(['normal', 'operator']).optional(),
};

/** Register the read-only discovery + health tools. */
function registerDiscoveryTools(server: McpServer): void {
  server.tool(envCheck.TOOL_NAME, envCheck.TOOL_DESCRIPTION, {}, async () =>
    jsonText(await envCheck.execute()),
  );
  server.tool(
    envCopy.TOOL_NAME,
    envCopy.TOOL_DESCRIPTION,
    { file: z.string().optional(), all: z.boolean().optional() },
    async (params) => jsonText(await envCopy.execute(params)),
  );
  server.tool(serviceStatus.TOOL_NAME, serviceStatus.TOOL_DESCRIPTION, {}, async () =>
    jsonText(await serviceStatus.execute()),
  );
  server.tool(
    storyStatus.TOOL_NAME,
    storyStatus.TOOL_DESCRIPTION,
    { stories: z.array(z.string()).min(1) },
    async (params) => jsonText(await storyStatus.execute(params)),
  );
  server.tool(mcpHealth.TOOL_NAME, mcpHealth.TOOL_DESCRIPTION, {}, async () =>
    jsonText(await mcpHealth.execute()),
  );
}

/** Register the env-lock acquire/release/status tools. */
function registerLockTools(server: McpServer): void {
  server.tool(envLock.STATUS_TOOL_NAME, envLock.STATUS_TOOL_DESCRIPTION, {}, async () =>
    jsonText(await envLock.executeStatus()),
  );
  server.tool(
    envLock.ACQUIRE_TOOL_NAME,
    envLock.ACQUIRE_TOOL_DESCRIPTION,
    ACQUIRE_SCHEMA,
    async (params) => jsonText(await envLock.executeAcquire(params)),
  );
  server.tool(
    envLock.RELEASE_TOOL_NAME,
    envLock.RELEASE_TOOL_DESCRIPTION,
    { branch: z.string().optional(), worktree: z.string().optional() },
    async (params) => jsonText(await envLock.executeRelease(params)),
  );
  server.tool(envLock.FORCE_RELEASE_TOOL_NAME, envLock.FORCE_RELEASE_TOOL_DESCRIPTION, {}, async () =>
    jsonText(await envLock.executeForceRelease()),
  );
}

/**
 * Construct the mcp-env MCP server with every tool registered.
 *
 * Pure factory: builds and returns the {@link McpServer} WITHOUT connecting a
 * transport, so unit tests can import this module without starting a real
 * StdioServerTransport. The CLI entrypoint (`index.ts`) owns the transport.
 */
export function setupServer(): McpServer {
  const server = new McpServer({ name: 'mcp-env', version: '0.1.0' });
  registerDiscoveryTools(server);
  registerLockTools(server);
  return server;
}
