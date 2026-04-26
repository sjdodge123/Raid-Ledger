import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock ./cdp.js so the index module never tries to actually connect to CDP.
// We still want the real `CdpUnreachableError` class — re-export it from the mock
// so tests can construct one and throw it from a fake handler.
vi.mock('./cdp.js', async () => {
  // The real module isn't loaded; we provide stubs sufficient for index.ts to import.
  class CdpUnreachableError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'CdpUnreachableError';
    }
  }
  return {
    CdpUnreachableError,
    connectCDP: vi.fn(async () => {
      throw new CdpUnreachableError('CDP unreachable');
    }),
    disconnectCDP: vi.fn(async () => undefined),
    getPage: vi.fn(async () => {
      throw new CdpUnreachableError('CDP unreachable');
    }),
    probeCDP: vi.fn(async () => ({ reachable: false })),
  };
});

// Mock all tool sub-modules so importing index.ts doesn't drag in playwright.
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

// Import after mocks. We grab the helper + the (mocked) error class.
import { withCdpErrorHandling } from './index.js';
import { CdpUnreachableError } from './cdp.js';

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('mcp-discord index — CDP error wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // CdpUnreachableError type
  // -------------------------------------------------------------------------

  describe('CdpUnreachableError', () => {
    it('is exported from ./cdp.js', () => {
      expect(CdpUnreachableError).toBeDefined();
      expect(typeof CdpUnreachableError).toBe('function');
    });

    it('is a subclass of Error', () => {
      const err = new CdpUnreachableError('test');
      expect(err).toBeInstanceOf(Error);
    });

    it('preserves the message passed to the constructor', () => {
      const err = new CdpUnreachableError('boom');
      expect(err.message).toBe('boom');
    });
  });

  // -------------------------------------------------------------------------
  // Standardized error response on CdpUnreachableError
  // -------------------------------------------------------------------------

  describe('handler throws CdpUnreachableError', () => {
    it('returns a standardized error response (isError: true)', async () => {
      const handler = async () => {
        throw new CdpUnreachableError('cdp not reachable');
      };

      const result = await withCdpErrorHandling(handler);

      expect(result.isError).toBe(true);
    });

    it('response content is a single text item', async () => {
      const handler = async () => {
        throw new CdpUnreachableError('cdp not reachable');
      };

      const result = await withCdpErrorHandling(handler);

      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
    });

    it('response text mentions Discord not running and the launch script', async () => {
      const handler = async () => {
        throw new CdpUnreachableError('cdp not reachable');
      };

      const result = await withCdpErrorHandling(handler);

      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('Discord not running');
      expect(text).toContain('./scripts/launch-discord.sh');
    });
  });

  // -------------------------------------------------------------------------
  // Generic errors are rethrown
  // -------------------------------------------------------------------------

  describe('handler throws a generic Error', () => {
    it('rethrows the error so the MCP framework can surface it', async () => {
      const handler = async () => {
        throw new Error('something else broke');
      };

      await expect(withCdpErrorHandling(handler)).rejects.toThrow(/something else broke/);
    });

    it('does not swallow non-CdpUnreachable errors as standardized responses', async () => {
      const handler = async () => {
        throw new TypeError('bad arg');
      };

      await expect(withCdpErrorHandling(handler)).rejects.toBeInstanceOf(TypeError);
    });
  });

  // -------------------------------------------------------------------------
  // Successful handler pass-through
  // -------------------------------------------------------------------------

  describe('handler succeeds', () => {
    it('returns the handler result verbatim', async () => {
      const expected = {
        content: [{ type: 'text' as const, text: 'ok' }],
      };
      const handler = async () => expected;

      const result = await withCdpErrorHandling(handler);

      expect(result).toEqual(expected);
    });

    it('does not set isError on a successful response', async () => {
      const handler = async () => ({
        content: [{ type: 'text' as const, text: 'fine' }],
      });

      const result = await withCdpErrorHandling(handler);

      expect(result.isError).toBeUndefined();
    });
  });
});
