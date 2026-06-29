import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CdpUnreachableError } from './cdp.js';
import * as screenshot from './tools/screenshot.js';
import * as readMessages from './tools/read-messages.js';
import * as navigate from './tools/navigate.js';
import * as verifyEmbed from './tools/verify-embed.js';
import * as clickButton from './tools/click-button.js';
import * as checkVoice from './tools/check-voice.js';
import * as checkNotification from './tools/check-notification.js';

export type ToolContentItem =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

export interface ToolResponse {
  content: ToolContentItem[];
  isError?: boolean;
}

/**
 * Detect playwright disconnection errors raised when Discord crashes or is
 * closed mid-session (TargetClosedError / BrowserClosedError, or generic
 * Errors whose message mentions the target/browser having been closed).
 */
function isPlaywrightDisconnect(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (typeof err.name === 'string' && err.name.includes('Closed')) return true;
  const message = err.message ?? '';
  return /has been closed|target.*closed|target crashed|browser.*closed|connection closed/i.test(
    message,
  );
}

/** Standardized "Discord not running / CDP unreachable" tool response. */
function discordNotRunningResponse(): ToolResponse {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text:
          'Discord not running or CDP unreachable. ' +
          'Launch Discord with CDP enabled: ./scripts/launch-discord.sh',
      },
    ],
  };
}

/**
 * Wraps an MCP tool handler so CDP-unreachable failures (startup connect) AND
 * mid-session playwright disconnections (Discord crashed/closed) return the
 * SAME standardized error response instead of crashing the server. All other
 * errors propagate so the MCP framework can surface them.
 */
export async function withCdpErrorHandling<T extends ToolResponse>(
  handler: () => Promise<T>,
): Promise<T | ToolResponse> {
  try {
    return await handler();
  } catch (err) {
    if (err instanceof CdpUnreachableError || isPlaywrightDisconnect(err)) {
      return discordNotRunningResponse();
    }
    throw err;
  }
}

/** Register screenshot + embed-verification tools (these can emit images). */
function registerCaptureTools(server: McpServer): void {
  server.tool(
    screenshot.TOOL_NAME,
    screenshot.TOOL_DESCRIPTION,
    { selector: z.string().optional(), fullPage: z.boolean().optional() },
    async (params) =>
      withCdpErrorHandling(async () => {
        const result = await screenshot.execute(params);
        return { content: [{ type: 'image', data: result.base64, mimeType: 'image/png' }] };
      }),
  );
  server.tool(
    verifyEmbed.TOOL_NAME,
    verifyEmbed.TOOL_DESCRIPTION,
    { messageIndex: z.number().optional() },
    async (params) =>
      withCdpErrorHandling(async () => {
        const result = await verifyEmbed.execute(params);
        const content: ToolContentItem[] = [
          { type: 'text', text: JSON.stringify(result.embed, null, 2) },
        ];
        if (result.screenshot) {
          content.push({ type: 'image', data: result.screenshot, mimeType: 'image/png' });
        }
        return { content };
      }),
  );
}

/** Register message-reading + navigation + notification-check tools. */
function registerMessageTools(server: McpServer): void {
  server.tool(
    readMessages.TOOL_NAME,
    readMessages.TOOL_DESCRIPTION,
    { count: z.number().optional() },
    async (params) =>
      withCdpErrorHandling(async () => {
        const result = await readMessages.execute(params);
        return { content: [{ type: 'text', text: JSON.stringify(result.messages, null, 2) }] };
      }),
  );
  server.tool(
    navigate.TOOL_NAME,
    navigate.TOOL_DESCRIPTION,
    { guildId: z.string(), channelId: z.string() },
    async (params) =>
      withCdpErrorHandling(async () => {
        const result = await navigate.execute(params);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }),
  );
  server.tool(
    checkNotification.TOOL_NAME,
    checkNotification.TOOL_DESCRIPTION,
    { contains: z.string() },
    async (params) =>
      withCdpErrorHandling(async () => {
        const result = await checkNotification.execute(params);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }),
  );
}

/** Register button-click + voice-membership tools. */
function registerActionTools(server: McpServer): void {
  server.tool(
    clickButton.TOOL_NAME,
    clickButton.TOOL_DESCRIPTION,
    { buttonLabel: z.string(), messageIndex: z.number().optional() },
    async (params) =>
      withCdpErrorHandling(async () => {
        const result = await clickButton.execute(params);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }),
  );
  server.tool(
    checkVoice.TOOL_NAME,
    checkVoice.TOOL_DESCRIPTION,
    { channelName: z.string().optional() },
    async (params) =>
      withCdpErrorHandling(async () => {
        const result = await checkVoice.execute(params);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }),
  );
}

/**
 * Construct the mcp-discord MCP server with every tool registered.
 *
 * Pure factory: builds and returns the {@link McpServer} WITHOUT connecting a
 * transport, so unit tests can import this module without starting a real
 * StdioServerTransport. The CLI entrypoint (`index.ts`) owns the transport.
 */
export function setupServer(): McpServer {
  const server = new McpServer({ name: 'mcp-discord', version: '0.1.0' });
  registerCaptureTools(server);
  registerMessageTools(server);
  registerActionTools(server);
  return server;
}
