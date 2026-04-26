import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock config before importing mcp-health (matches story-status.test.ts pattern)
vi.mock('../config.js', () => ({
  PROJECT_DIR: '/fake/project',
}));

// Mock node:fs/promises for both .mcp.json read and entrypoint existence checks.
const mockReadFile = vi.fn();
const mockAccess = vi.fn();
vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  access: (...args: unknown[]) => mockAccess(...args),
  default: {
    readFile: (...args: unknown[]) => mockReadFile(...args),
    access: (...args: unknown[]) => mockAccess(...args),
  },
}));

// Mock node:child_process — execFile is the simplest spawn surface for --self-check.
const mockExecFile = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
  default: {
    execFile: (...args: unknown[]) => mockExecFile(...args),
  },
}));

// Import after mocks are registered.
import { execute, TOOL_NAME, TOOL_DESCRIPTION } from './mcp-health.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simulate execFile invoking its callback with (err, stdout, stderr). */
function execFileOk(stdout = 'OK', stderr = ''): void {
  mockExecFile.mockImplementationOnce((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
    // Some callers pass (cmd, args, cb) without options — handle both forms.
    const callback = typeof _opts === 'function' ? (_opts as typeof cb) : cb;
    callback(null, stdout, stderr);
  });
}

/** Simulate execFile failing with a non-zero exit code. */
function execFileFail(exitCode = 1, stderr = 'boom'): void {
  mockExecFile.mockImplementationOnce((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
    const callback = typeof _opts === 'function' ? (_opts as typeof cb) : cb;
    // child_process.execFile sets `code` to the exit code on its error object.
    const err = Object.assign(new Error(stderr), { code: exitCode });
    callback(err as Error, '', stderr);
  });
}

/**
 * Simulate execFile never invoking the callback (for timeout coverage).
 * The implementation under test is expected to enforce its own timeout.
 */
function execFileHang(): void {
  mockExecFile.mockImplementationOnce(() => {
    // Intentionally never call the callback.
    return { kill: vi.fn() } as unknown as ReturnType<typeof mockExecFile>;
  });
}

/** Default `.mcp.json` content with two local servers + one third-party. */
const DEFAULT_MCP_JSON = JSON.stringify({
  mcpServers: {
    playwright: {
      command: 'npx',
      args: ['@playwright/mcp@0.0.41', '--headless'],
    },
    'mcp-env': {
      type: 'stdio',
      command: 'npx',
      args: ['tsx', 'tools/mcp-env/src/index.ts'],
      env: {},
    },
    'mcp-discord': {
      type: 'stdio',
      command: 'npx',
      args: ['tsx', 'tools/mcp-discord/src/index.ts'],
      env: {},
    },
  },
});

/** Configure fs.readFile to return the given .mcp.json content. */
function setMcpJson(content: string): void {
  mockReadFile.mockImplementation(async (path: unknown) => {
    if (typeof path === 'string' && path.endsWith('.mcp.json')) return content;
    if (path instanceof URL && path.pathname.endsWith('.mcp.json')) return content;
    throw new Error(`Unexpected readFile path: ${String(path)}`);
  });
}

/** Configure fs.access to succeed for every path (entrypoints exist). */
function entrypointsExist(): void {
  mockAccess.mockResolvedValue(undefined);
}

/** Configure fs.access to fail for any path containing the given fragment. */
function entrypointMissing(fragment: string): void {
  mockAccess.mockImplementation(async (path: unknown) => {
    const p: string = typeof path === 'string' ? path : (path as URL).pathname;
    if (p.includes(fragment)) {
      const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      throw err;
    }
    return undefined;
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('mcp-health tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Tool metadata
  // -------------------------------------------------------------------------

  describe('TOOL_NAME and TOOL_DESCRIPTION', () => {
    it('exports TOOL_NAME as mcp_health', () => {
      expect(TOOL_NAME).toBe('mcp_health');
    });

    it('exports a non-empty TOOL_DESCRIPTION string', () => {
      expect(typeof TOOL_DESCRIPTION).toBe('string');
      expect(TOOL_DESCRIPTION.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Healthy state
  // -------------------------------------------------------------------------

  describe('healthy state', () => {
    it('reports both local servers as healthy when entrypoints exist and --self-check exits 0', async () => {
      setMcpJson(DEFAULT_MCP_JSON);
      entrypointsExist();
      execFileOk(); // mcp-env --self-check
      execFileOk(); // mcp-discord --self-check

      const result = await execute();

      expect(result.servers['mcp-env']).toEqual({ status: 'healthy' });
      expect(result.servers['mcp-discord']).toEqual({ status: 'healthy' });
    });

    it('passes --self-check as an argument when spawning the entrypoint', async () => {
      setMcpJson(DEFAULT_MCP_JSON);
      entrypointsExist();
      execFileOk();
      execFileOk();

      await execute();

      // At least one of the spawn calls must include '--self-check' in argv.
      const argLists = mockExecFile.mock.calls.map((call) => call[1]);
      const everySpawnHasFlag = argLists.every((args) =>
        Array.isArray(args) && (args as string[]).includes('--self-check'),
      );
      expect(everySpawnHasFlag).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Entrypoint missing
  // -------------------------------------------------------------------------

  describe('entrypoint missing', () => {
    it('reports unhealthy with an entrypoint-mentioning error when source file does not exist', async () => {
      setMcpJson(DEFAULT_MCP_JSON);
      entrypointMissing('mcp-discord');
      // mcp-env still spawns successfully
      execFileOk();

      const result = await execute();

      const discord = result.servers['mcp-discord'];
      expect(discord.status).toBe('unhealthy');
      if (discord.status === 'unhealthy') {
        expect(discord.error.toLowerCase()).toMatch(/entrypoint/);
      }
    });

    it('does not attempt to spawn when the entrypoint is missing', async () => {
      setMcpJson(DEFAULT_MCP_JSON);
      entrypointMissing('mcp-discord');
      // Only mcp-env should spawn.
      execFileOk();

      await execute();

      // Exactly one spawn (for mcp-env), none for mcp-discord.
      expect(mockExecFile).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Spawn failure (non-zero exit)
  // -------------------------------------------------------------------------

  describe('spawn fails (non-zero exit)', () => {
    it('reports unhealthy with a message describing the failure', async () => {
      setMcpJson(DEFAULT_MCP_JSON);
      entrypointsExist();
      execFileFail(2, 'module not found'); // mcp-env fails
      execFileOk(); // mcp-discord ok

      const result = await execute();

      const env = result.servers['mcp-env'];
      expect(env.status).toBe('unhealthy');
      if (env.status === 'unhealthy') {
        // The error should reference either the exit code or the stderr text.
        const errLower = env.error.toLowerCase();
        const mentionsExit = /\b2\b/.test(env.error) || errLower.includes('exit');
        const mentionsStderr = errLower.includes('module not found');
        expect(mentionsExit || mentionsStderr).toBe(true);
      }
    });

    it('does not affect the other server when one fails', async () => {
      setMcpJson(DEFAULT_MCP_JSON);
      entrypointsExist();
      execFileFail(1, 'broken'); // mcp-env fails
      execFileOk(); // mcp-discord healthy

      const result = await execute();

      expect(result.servers['mcp-env'].status).toBe('unhealthy');
      expect(result.servers['mcp-discord'].status).toBe('healthy');
    });
  });

  // -------------------------------------------------------------------------
  // Spawn timeout
  // -------------------------------------------------------------------------

  describe('spawn timeout', () => {
    it('reports unhealthy with a timeout-mentioning error when --self-check hangs past 3s', async () => {
      vi.useFakeTimers();
      setMcpJson(DEFAULT_MCP_JSON);
      entrypointsExist();
      execFileHang(); // mcp-env hangs
      execFileOk(); // mcp-discord ok (in case order matters; might be sequential)

      const promise = execute();

      // Advance past the 3s timeout window.
      await vi.advanceTimersByTimeAsync(3_500);

      const result = await promise;
      const env = result.servers['mcp-env'];
      expect(env.status).toBe('unhealthy');
      if (env.status === 'unhealthy') {
        expect(env.error.toLowerCase()).toMatch(/timeout|timed out/);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Third-party server skipped
  // -------------------------------------------------------------------------

  describe('third-party server skipped', () => {
    it('marks the playwright server as skipped without spawning or fs-checking it', async () => {
      setMcpJson(DEFAULT_MCP_JSON);
      entrypointsExist();
      execFileOk();
      execFileOk();

      const result = await execute();

      const pw = result.servers['playwright'];
      expect(pw.status).toBe('skipped');
      if (pw.status === 'skipped') {
        expect(pw.reason.toLowerCase()).toMatch(/third-party|not local/);
      }

      // Only the two local servers should have been spawned.
      expect(mockExecFile).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------

  describe('summary', () => {
    it('returns a non-empty summary string mentioning counts', async () => {
      setMcpJson(DEFAULT_MCP_JSON);
      entrypointsExist();
      execFileOk();
      execFileOk();

      const result = await execute();

      expect(typeof result.summary).toBe('string');
      expect(result.summary.length).toBeGreaterThan(0);
      // Summary should mention healthy and skipped counts.
      expect(result.summary).toMatch(/2\s*healthy/i);
      expect(result.summary).toMatch(/1\s*skipped/i);
    });
  });
});
