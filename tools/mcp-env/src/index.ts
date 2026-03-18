import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as envCheck from './tools/env-check.js';
import * as envCopy from './tools/env-copy.js';
import * as serviceStatus from './tools/service-status.js';

const server = new McpServer({
  name: 'mcp-env',
  version: '0.1.0',
});

// --- Tool registrations ---

server.tool(
  envCheck.TOOL_NAME,
  envCheck.TOOL_DESCRIPTION,
  {},
  async () => {
    const result = await envCheck.execute();
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  },
);

server.tool(
  envCopy.TOOL_NAME,
  envCopy.TOOL_DESCRIPTION,
  { file: z.string().optional(), all: z.boolean().optional() },
  async (params) => {
    const result = await envCopy.execute(params);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  },
);

server.tool(
  serviceStatus.TOOL_NAME,
  serviceStatus.TOOL_DESCRIPTION,
  {},
  async () => {
    const result = await serviceStatus.execute();
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  },
);

// --- Server lifecycle ---

/** Start the MCP server on stdio transport. */
async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[mcp-env] MCP server running on stdio');

  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });
}

main().catch((err: unknown) => {
  console.error('[mcp-env] Fatal:', err);
  process.exit(1);
});
