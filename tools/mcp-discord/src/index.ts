import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { connectCDP, disconnectCDP } from './cdp.js';
import { setupServer, withCdpErrorHandling } from './register-tools.js';

// Re-exported so existing unit tests can import the wrapper from this entrypoint
// without the import starting a real StdioServerTransport.
export { withCdpErrorHandling };

/** Register process-level guards so unhandled errors don't crash the server. */
function installProcessGuards(): void {
  process.on('uncaughtException', (err) => {
    console.error('[mcp-discord] Uncaught exception:', err);
  });
  process.on('unhandledRejection', (err) => {
    console.error('[mcp-discord] Unhandled rejection:', err);
  });
}

/** Start the MCP server on stdio transport and kick off background CDP connect. */
async function main(): Promise<void> {
  // --self-check is a "module loaded fine" probe used by mcp_health.
  // Must NOT fail when CDP is unreachable.
  if (process.argv.includes('--self-check')) {
    console.log('[mcp-discord] self-check OK');
    process.exit(0);
  }

  installProcessGuards();

  // Connect MCP transport FIRST so the Claude Code handshake succeeds immediately.
  const server = setupServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[mcp-discord] MCP server running on stdio');

  // Attempt CDP connection in background — don't block the MCP handshake.
  connectCDP().catch((err) => {
    console.error(
      '[mcp-discord] WARNING: CDP connection failed at startup. ' +
        'Tools will attempt lazy reconnection when called.\n' +
        `Error: ${err}`,
    );
  });

  const shutdown = async (): Promise<void> => {
    await server.close();
    await disconnectCDP();
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
  main().catch((err) => {
    console.error('[mcp-discord] Fatal:', err);
    process.exit(1);
  });
}
