import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config.js so importing the tool sub-modules doesn't shell out to git
// (config.ts runs `git worktree list` at import). Matches mcp-health.test.ts.
vi.mock('./config.js', () => ({
  PROJECT_DIR: '/fake/project',
  MAIN_REPO: null,
  IS_WORKTREE: false,
}));

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

// If setupServer ever tried to start a transport, this would be constructed.
const transportConstructed = vi.fn();
vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class {
    constructor() {
      transportConstructed();
    }
  },
}));

import { setupServer } from './register-tools.js';

describe('mcp-env setupServer', () => {
  beforeEach(() => {
    toolNames.length = 0;
    connectCalls.length = 0;
    transportConstructed.mockClear();
  });

  it('returns a configured server with tools registered', () => {
    const server = setupServer();

    expect(server).toBeDefined();
    expect(toolNames.length).toBeGreaterThan(0);
  });

  it('does NOT connect a transport (importing/building must not start the server)', () => {
    setupServer();

    expect(connectCalls).toHaveLength(0);
    expect(transportConstructed).not.toHaveBeenCalled();
  });

  it('registers the mcp_health and env_lock_acquire tools', () => {
    setupServer();

    expect(toolNames).toContain('mcp_health');
    expect(toolNames).toContain('env_lock_acquire');
  });
});
