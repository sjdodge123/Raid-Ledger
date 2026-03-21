import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { connectCDP, disconnectCDP } from './cdp.js';
import * as screenshot from './tools/screenshot.js';
import * as readMessages from './tools/read-messages.js';
import * as navigate from './tools/navigate.js';
import * as verifyEmbed from './tools/verify-embed.js';
import * as clickButton from './tools/click-button.js';
import * as checkVoice from './tools/check-voice.js';
import * as checkNotification from './tools/check-notification.js';

const server = new McpServer({
  name: 'mcp-discord',
  version: '0.1.0',
});

// --- Tool registrations ---

server.tool(
  screenshot.TOOL_NAME,
  screenshot.TOOL_DESCRIPTION,
  { selector: z.string().optional(), fullPage: z.boolean().optional() },
  async (params) => {
    const result = await screenshot.execute(params);
    return {
      content: [{ type: 'image', data: result.base64, mimeType: 'image/png' }],
    };
  },
);

server.tool(
  readMessages.TOOL_NAME,
  readMessages.TOOL_DESCRIPTION,
  { count: z.number().optional() },
  async (params) => {
    const result = await readMessages.execute(params);
    return {
      content: [{ type: 'text', text: JSON.stringify(result.messages, null, 2) }],
    };
  },
);

server.tool(
  navigate.TOOL_NAME,
  navigate.TOOL_DESCRIPTION,
  { guildId: z.string(), channelId: z.string() },
  async (params) => {
    const result = await navigate.execute(params);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  },
);

server.tool(
  verifyEmbed.TOOL_NAME,
  verifyEmbed.TOOL_DESCRIPTION,
  { messageIndex: z.number().optional() },
  async (params) => {
    const result = await verifyEmbed.execute(params);
    const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [
      { type: 'text', text: JSON.stringify(result.embed, null, 2) },
    ];
    if (result.screenshot) {
      content.push({
        type: 'image',
        data: result.screenshot,
        mimeType: 'image/png',
      });
    }
    return { content };
  },
);

server.tool(
  clickButton.TOOL_NAME,
  clickButton.TOOL_DESCRIPTION,
  { buttonLabel: z.string(), messageIndex: z.number().optional() },
  async (params) => {
    const result = await clickButton.execute(params);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  },
);

server.tool(
  checkVoice.TOOL_NAME,
  checkVoice.TOOL_DESCRIPTION,
  { channelName: z.string().optional() },
  async (params) => {
    const result = await checkVoice.execute(params);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  },
);

server.tool(
  checkNotification.TOOL_NAME,
  checkNotification.TOOL_DESCRIPTION,
  { contains: z.string() },
  async (params) => {
    const result = await checkNotification.execute(params);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  },
);

// --- Server lifecycle ---

async function main() {
  // Connect MCP transport FIRST so Claude Code handshake succeeds immediately
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[mcp-discord] MCP server running on stdio');

  // Attempt CDP connection in background — don't block the MCP handshake
  connectCDP().catch((err) => {
    console.error(
      '[mcp-discord] WARNING: CDP connection failed at startup. ' +
        'Tools will attempt lazy reconnection when called.\n' +
        `Error: ${err}`,
    );
  });

  const shutdown = async () => {
    await server.close();
    await disconnectCDP();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Prevent unhandled errors from crashing the server
process.on('uncaughtException', (err) => {
  console.error('[mcp-discord] Uncaught exception:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[mcp-discord] Unhandled rejection:', err);
});

main().catch((err) => {
  console.error('[mcp-discord] Fatal:', err);
  process.exit(1);
});
