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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hold the most recent execFile invocation args for assertions.
let lastExecFileArgs: { file: string; args: string[] } | null = null;

vi.mock('node:child_process', async () => {
  // Mock execFile so curlOnVM's promisified call resolves with a known
  // stdout shape AND we can inspect the remote string ssh was handed.
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
    spawn: vi.fn(),
  };
});

beforeEach(() => {
  lastExecFileArgs = null;
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
    const { executeStatus } = await import('../test-plan.js');
    const prev = process.env.RL_AGENT_TOKEN;
    process.env.RL_AGENT_TOKEN = 'bad\0null';
    try {
      const result = await executeStatus({ slug: 'aaa' });
      expect(result).toMatchObject({ ok: false });
      expect(JSON.stringify(result)).toMatch(/NUL|invalid header value/i);
    } finally {
      if (prev === undefined) delete process.env.RL_AGENT_TOKEN;
      else process.env.RL_AGENT_TOKEN = prev;
    }
  });
});

describe('AC7 — RL_AGENT_TOKEN does not appear in docker run argv', () => {
  it('passes the token via `docker run -e RL_AGENT_TOKEN_VALUE=…` (env injection)', async () => {
    const { executeStatus } = await import('../test-plan.js');
    const prev = process.env.RL_AGENT_TOKEN;
    process.env.RL_AGENT_TOKEN = 'shh-secret-123';
    try {
      // First call: /api/state pre-flight (status); second call: GET test-plans.
      // We only need to inspect the most-recent ssh invocation args.
      await executeStatus({ slug: 'aaa' });
      expect(lastExecFileArgs).not.toBeNull();
      // The remote shell string is the LAST positional arg to ssh.
      const remote = lastExecFileArgs!.args[lastExecFileArgs!.args.length - 1];
      // STRICT: token MUST be injected as a docker env var, not interpolated
      // as a literal -H header value in argv.
      expect(remote).toMatch(/-e\s+RL_AGENT_TOKEN_VALUE=/);
      // STRICT: the curl -H arg references the container-side env var
      // by name. The literal $RL_AGENT_TOKEN_VALUE expands AFTER docker
      // parses argv, so it is not visible via /proc/<pid>/cmdline.
      expect(remote).toContain('$RL_AGENT_TOKEN_VALUE');
    } finally {
      if (prev === undefined) delete process.env.RL_AGENT_TOKEN;
      else process.env.RL_AGENT_TOKEN = prev;
    }
  });

  it('does NOT place the literal token value as a -H argument to curl', async () => {
    const { executeStatus } = await import('../test-plan.js');
    const prev = process.env.RL_AGENT_TOKEN;
    const TOKEN = 'literal-token-should-not-leak-abc';
    process.env.RL_AGENT_TOKEN = TOKEN;
    try {
      await executeStatus({ slug: 'aaa' });
      const remote = lastExecFileArgs!.args[lastExecFileArgs!.args.length - 1];
      // The literal value MUST NOT appear adjacent to `-H 'X-Agent-Token:`
      // — that's the today shape we're moving away from.
      expect(remote).not.toMatch(
        new RegExp(`-H\\s+['"]X-Agent-Token:\\s*${TOKEN}`),
      );
      // And nowhere bound as an argv-visible -H literal.
      expect(remote).not.toContain(`X-Agent-Token: ${TOKEN}`);
    } finally {
      if (prev === undefined) delete process.env.RL_AGENT_TOKEN;
      else process.env.RL_AGENT_TOKEN = prev;
    }
  });

  it('preserves shell-quoting safety against $(…) command-substitution in the token', async () => {
    const { executeStatus } = await import('../test-plan.js');
    const prev = process.env.RL_AGENT_TOKEN;
    // Operator-controlled, but defensive — token must reach the container
    // as a literal, not as a subshell expansion.
    process.env.RL_AGENT_TOKEN = '$(echo HACKED)';
    try {
      await executeStatus({ slug: 'aaa' });
      const remote = lastExecFileArgs!.args[lastExecFileArgs!.args.length - 1];
      // The literal `$(echo HACKED)` should appear quoted somewhere in
      // the remote string (so the OUTER ssh shell doesn't expand it).
      // Easiest assertion: the literal substring is present unchanged.
      expect(remote).toContain('echo HACKED');
      // Inner curl also must not see it as an expanded value — the
      // -H argument should reference $RL_AGENT_TOKEN_VALUE (the env var),
      // not the literal `$(echo HACKED)` interpolated by the outer shell.
      expect(remote).toContain('$RL_AGENT_TOKEN_VALUE');
    } finally {
      if (prev === undefined) delete process.env.RL_AGENT_TOKEN;
      else process.env.RL_AGENT_TOKEN = prev;
    }
  });
});
