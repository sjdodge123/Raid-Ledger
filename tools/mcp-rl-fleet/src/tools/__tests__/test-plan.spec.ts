// ROK-1331 M6a — test-plan.ts cleanup chunks (TDD red).
//
// Two cleanups under test:
//   AC6 — CRLF/null reject in curlOnVM header VALUE (belt-and-suspenders
//         over libcurl's own strip).
//   AC7 — `X-Agent-Token` moved off `docker run` argv. The token must be
//         injected via `docker run -e RL_AGENT_TOKEN_VALUE=...` and curl's
//         `-H` arg must reference the bash variable `$RL_AGENT_TOKEN_VALUE`
//         (literal, expanded inside the container).
//
// We need to assert against the EXACT shell command curlOnVM constructs
// before passing it to execFile('ssh', …). The current implementation
// (test-plan.ts) builds the remote string inline inside `curlOnVM` and
// doesn't expose it. To test deterministically, we mock `node:child_process`
// and intercept the args ssh is invoked with.

import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hold the most recent execFile invocation args for assertions.
let lastExecFileArgs: { file: string; args: string[] } | null = null;
// ROK-1336 #9 — sensitive-header path now uses spawn + stdin instead of
// execFile (so the token never lands in argv). Capture both the spawn argv
// AND the stdin payload so AC7 tests can assert the new contract.
let lastSpawnArgs: { file: string; args: string[] } | null = null;
let lastSpawnStdin: string | null = null;

vi.mock('node:child_process', async () => {
  return {
    execFile: (
      file: string,
      args: string[],
      _opts: unknown,
      cb: (
        err: Error | null,
        result: { stdout: string; stderr: string } | null,
      ) => void,
    ) => {
      lastExecFileArgs = { file, args };
      cb(null, { stdout: '{}\nRL_STATUS:200', stderr: '' });
      return { kill: () => undefined };
    },
    spawn: (file: string, args: string[]) => {
      lastSpawnArgs = { file, args };
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        stdin: { end: (payload: string) => void };
        kill: () => void;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = {
        end: (payload: string) => {
          lastSpawnStdin = payload;
        },
      };
      child.kill = () => undefined;
      // Fire success on the next tick: emit the same canned stdout the
      // execFile mock returns so the curlOnVM consumer parses RL_STATUS.
      setImmediate(() => {
        child.stdout.emit('data', Buffer.from('{}\nRL_STATUS:200'));
        child.emit('close', 0);
      });
      return child;
    },
  };
});

beforeEach(() => {
  lastExecFileArgs = null;
  lastSpawnArgs = null;
  lastSpawnStdin = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AC6 — curlOnVM rejects CR/LF/NUL in header values', () => {
  it('throws when a header value contains \\r\\n (CRLF injection attempt)', async () => {
    const { executeStatus } = await import('../test-plan.js');
    // Force the env var so executeStatus sets the X-Agent-Token header
    // path. We pass a poisoned value via a wrapper that overrides the
    // header builder; simplest is to patch process.env then call the
    // exported curlOnVM-using function with a header object we can
    // smuggle in. Since executeStatus reads RL_AGENT_TOKEN from env,
    // a CRLF in that env var should surface as the rejection.
    const prev = process.env.RL_AGENT_TOKEN;
    process.env.RL_AGENT_TOKEN = 'bad\r\nInjected: yes';
    try {
      const result = await executeStatus({ slug: 'aaa' });
      // Should NOT have made the SSH call — exec was never invoked OR
      // the function returned an error envelope.
      expect(result).toMatchObject({
        ok: false,
      });
      const errorMessage = JSON.stringify(result);
      expect(errorMessage).toMatch(/CR|LF|NUL|invalid header value/i);
    } finally {
      if (prev === undefined) delete process.env.RL_AGENT_TOKEN;
      else process.env.RL_AGENT_TOKEN = prev;
    }
  });

  it('throws when a header value contains \\0 (NUL byte)', async () => {
    const { validateCurlHeaderValueForTest } = await import('../test-plan.js');
    expect(() => validateCurlHeaderValueForTest('X-Agent-Token', 'bad\0null')).toThrow(
      /NUL|invalid header value/i,
    );
  });
});

describe('AC7 — RL_AGENT_TOKEN does not appear in docker run argv', () => {
  it('passes the token via stdin → bash `read` → docker `-e RL_AGENT_TOKEN_VALUE` (env-name-only)', async () => {
    const { executeStatus } = await import('../test-plan.js');
    const prev = process.env.RL_AGENT_TOKEN;
    const TOKEN = 'shh-secret-123';
    process.env.RL_AGENT_TOKEN = TOKEN;
    try {
      await executeStatus({ slug: 'aaa' });
      // ROK-1336 #9: sensitive-header path now uses spawn + stdin, not execFile.
      expect(lastSpawnArgs).not.toBeNull();
      const remote = lastSpawnArgs!.args[lastSpawnArgs!.args.length - 1];
      // STRICT: docker -e flag carries ONLY the env var name (no `=value`),
      // so /proc/<docker_pid>/cmdline never sees the token literal.
      expect(remote).toMatch(/-e\s+RL_AGENT_TOKEN_VALUE(?!\s*=)/);
      expect(remote).not.toMatch(/-e\s+RL_AGENT_TOKEN_VALUE\s*=/);
      // The remote bash prelude reads the value from stdin into the env.
      expect(remote).toContain('read -r RL_AGENT_TOKEN_VALUE');
      expect(remote).toContain('export RL_AGENT_TOKEN_VALUE');
      // The curl -H arg references the env var; container-side bash
      // expands it AFTER docker parses argv → still no argv leak.
      expect(remote).toContain('$RL_AGENT_TOKEN_VALUE');
      // The token literal MUST be in stdin, not argv.
      expect(lastSpawnStdin).toBe(`${TOKEN}\n`);
      expect(remote).not.toContain(TOKEN);
    } finally {
      if (prev === undefined) delete process.env.RL_AGENT_TOKEN;
      else process.env.RL_AGENT_TOKEN = prev;
    }
  });

  it('does NOT place the literal token value anywhere in argv', async () => {
    const { executeStatus } = await import('../test-plan.js');
    const prev = process.env.RL_AGENT_TOKEN;
    const TOKEN = 'literal-token-should-not-leak-abc';
    process.env.RL_AGENT_TOKEN = TOKEN;
    try {
      await executeStatus({ slug: 'aaa' });
      const remote = lastSpawnArgs!.args[lastSpawnArgs!.args.length - 1];
      // The literal value must NOT appear anywhere in the ssh argv.
      expect(remote).not.toContain(TOKEN);
      expect(remote).not.toMatch(
        new RegExp(`-H\\s+['"]X-Agent-Token:\\s*${TOKEN}`),
      );
      expect(remote).not.toContain(`X-Agent-Token: ${TOKEN}`);
    } finally {
      if (prev === undefined) delete process.env.RL_AGENT_TOKEN;
      else process.env.RL_AGENT_TOKEN = prev;
    }
  });

  it('keeps $(…) command-substitution out of any expanding shell', async () => {
    const { executeStatus } = await import('../test-plan.js');
    const prev = process.env.RL_AGENT_TOKEN;
    // Hostile token: defensive — value must reach the container as a
    // literal, never expanded by the outer ssh shell.
    process.env.RL_AGENT_TOKEN = '$(echo HACKED)';
    try {
      await executeStatus({ slug: 'aaa' });
      const remote = lastSpawnArgs!.args[lastSpawnArgs!.args.length - 1];
      // The value travels via stdin → bash `read -r` (which does NOT
      // expand command substitution on the value). The remote argv has
      // NO trace of the value at all, hostile or otherwise.
      expect(remote).not.toContain('echo HACKED');
      expect(remote).not.toContain('$(echo');
      expect(lastSpawnStdin).toBe('$(echo HACKED)\n');
      // Inner curl still references the env var by name.
      expect(remote).toContain('$RL_AGENT_TOKEN_VALUE');
    } finally {
      if (prev === undefined) delete process.env.RL_AGENT_TOKEN;
      else process.env.RL_AGENT_TOKEN = prev;
    }
  });
});
