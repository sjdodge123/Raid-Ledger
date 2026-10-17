import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setupServer } from './register-tools.js';

/** Register process-level guards so unhandled errors don't crash the server. */
function installProcessGuards(): void {
  process.on('uncaughtException', (err) => {
    console.error('[mcp-env] Uncaught exception:', err);
  });
  process.on('unhandledRejection', (err) => {
    console.error('[mcp-env] Unhandled rejection:', err);
  });
}

/** Start the MCP server on stdio transport. */
async function main(): Promise<void> {
  // --self-check is a "module loaded fine" probe used by mcp_health.
  if (process.argv.includes('--self-check')) {
    console.log('[mcp-env] self-check OK');
    process.exit(0);
  }

  installProcessGuards();
  const server = setupServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[mcp-env] MCP server running on stdio');

  const shutdown = async (): Promise<void> => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/** True only when this module is the process entrypoint (not imported by a test). */
function isEntrypoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  main().catch((err: unknown) => {
    console.error('[mcp-env] Fatal:', err);
    process.exit(1);
  });
}
