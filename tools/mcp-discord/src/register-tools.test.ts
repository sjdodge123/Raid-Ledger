import { describe, it, expect, vi, beforeEach } from 'vitest';

// Replace the SDK McpServer with a lightweight double so we can observe tool
// registrations and prove setupServer NEVER connects a transport.
const toolNames: string[] = [];
const connectCalls: unknown[] = [];
vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class {
    constructor(public readonly info: unknown) {}
    tool(name: string): void {
      toolNames.push(name);
    }
    async connect(transport: unknown): Promise<void> {
      connectCalls.push(transport);
    }
    async close(): Promise<void> {}
  },
}));

// Provide the real CdpUnreachableError class without loading playwright via ./cdp.js.
vi.mock('./cdp.js', () => {
  class CdpUnreachableError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'CdpUnreachableError';
    }
  }
  return {
    CdpUnreachableError,
    connectCDP: vi.fn(),
    disconnectCDP: vi.fn(),
    getPage: vi.fn(),
    probeCDP: vi.fn(),
  };
});

// Mock the tool sub-modules so importing register-tools doesn't drag in playwright.
vi.mock('./tools/screenshot.js', () => ({
  TOOL_NAME: 'discord_screenshot',
  TOOL_DESCRIPTION: 'screenshot',
  execute: vi.fn(),
}));
vi.mock('./tools/read-messages.js', () => ({
  TOOL_NAME: 'discord_read_messages',
  TOOL_DESCRIPTION: 'read messages',
  execute: vi.fn(),
}));
vi.mock('./tools/navigate.js', () => ({
  TOOL_NAME: 'discord_navigate_channel',
  TOOL_DESCRIPTION: 'navigate',
  execute: vi.fn(),
}));
vi.mock('./tools/verify-embed.js', () => ({
  TOOL_NAME: 'discord_verify_embed',
  TOOL_DESCRIPTION: 'verify embed',
  execute: vi.fn(),
}));
vi.mock('./tools/click-button.js', () => ({
  TOOL_NAME: 'discord_click_button',
  TOOL_DESCRIPTION: 'click button',
  execute: vi.fn(),
}));
vi.mock('./tools/check-voice.js', () => ({
  TOOL_NAME: 'discord_check_voice_members',
  TOOL_DESCRIPTION: 'check voice',
  execute: vi.fn(),
}));
vi.mock('./tools/check-notification.js', () => ({
  TOOL_NAME: 'discord_check_notification',
  TOOL_DESCRIPTION: 'check notification',
  execute: vi.fn(),
}));

// Import after mocks are registered.
import { setupServer, withCdpErrorHandling } from './register-tools.js';
import { CdpUnreachableError } from './cdp.js';

/** Build a playwright-style error with a custom name (e.g. TargetClosedError). */
function namedError(name: string, message: string): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

describe('mcp-discord register-tools', () => {
  beforeEach(() => {
    toolNames.length = 0;
    connectCalls.length = 0;
  });

  // -------------------------------------------------------------------------
  // ITEM 1 — setupServer is a pure factory (no transport)
  // -------------------------------------------------------------------------

  describe('setupServer', () => {
    it('registers tools without connecting a transport', () => {
      const server = setupServer();

      expect(server).toBeDefined();
      expect(toolNames.length).toBeGreaterThan(0);
      expect(connectCalls).toHaveLength(0);
    });

    it('registers the screenshot and voice tools', () => {
      setupServer();

      expect(toolNames).toContain('discord_screenshot');
      expect(toolNames).toContain('discord_check_voice_members');
    });
  });

  // -------------------------------------------------------------------------
  // ITEM 2 — mid-session playwright disconnections remap to "Discord not running"
  // -------------------------------------------------------------------------

  describe('withCdpErrorHandling — playwright disconnection', () => {
    it('remaps a TargetClosedError to the standardized "Discord not running" response', async () => {
      const handler = async (): Promise<never> => {
        throw namedError('TargetClosedError', 'Target page, context or browser has been closed');
      };

      const result = await withCdpErrorHandling(handler);

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('Discord not running');
      expect(text).toContain('./scripts/launch-discord.sh');
    });

    it('remaps a generic Error whose message says the browser has been closed', async () => {
      const handler = async (): Promise<never> => {
        throw new Error('Target page, context or browser has been closed');
      };

      const result = await withCdpErrorHandling(handler);

      expect(result.isError).toBe(true);
    });

    it('still remaps the original CdpUnreachableError (startup connect failure)', async () => {
      const handler = async (): Promise<never> => {
        throw new CdpUnreachableError('cdp not reachable');
      };

      const result = await withCdpErrorHandling(handler);

      expect(result.isError).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // ITEM 2 regression guard — unrelated errors must still propagate
  // -------------------------------------------------------------------------

  describe('withCdpErrorHandling — unrelated errors propagate', () => {
    it('rethrows a generic Error that is not a disconnection', async () => {
      const handler = async (): Promise<never> => {
        throw new Error('something else broke');
      };

      await expect(withCdpErrorHandling(handler)).rejects.toThrow(/something else broke/);
    });

    it('rethrows a TypeError', async () => {
      const handler = async (): Promise<never> => {
        throw new TypeError('bad arg');
      };

      await expect(withCdpErrorHandling(handler)).rejects.toBeInstanceOf(TypeError);
    });
  });
});
