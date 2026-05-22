// ROK-1338 PR-2 — rl_env_inspect tests.
//
// Mirrors infra-logs.spec.ts structure: vi.mock('node:child_process') stubs
// SSH, then assertions cover argv shape, enum/path mapping, structured error
// codes, and 64KB truncation envelope.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecFile = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
  execFileSync: (...args: unknown[]) => mockExecFile(...args),
  default: {
    execFile: (...args: unknown[]) => mockExecFile(...args),
    execFileSync: (...args: unknown[]) => mockExecFile(...args),
  },
}));

import {
  execute,
  ENV_INSPECT_TARGETS,
  TARGET_TO_PATH,
  EnvInspectTargetSchema,
  EnvInspectParamsSchema,
} from '../env-inspect.js';

function execFileOk(stdout: string, stderr = ''): void {
  mockExecFile.mockImplementationOnce(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      const callback = typeof _opts === 'function' ? (_opts as typeof cb) : cb;
      callback(null, stdout, stderr);
    },
  );
}

function execFileFail(stderr: string, code: number | string = 1): void {
  mockExecFile.mockImplementationOnce(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      const callback = typeof _opts === 'function' ? (_opts as typeof cb) : cb;
      const err = Object.assign(new Error(stderr), { code, stderr });
      callback(err, '', stderr);
    },
  );
}

beforeEach(() => {
  mockExecFile.mockReset();
});

describe('rl_env_inspect — enum + path mapping', () => {
  it('exposes the operator-locked 2-value target enum', () => {
    expect(ENV_INSPECT_TARGETS).toEqual(['nginx-conf', 'supervisor-conf']);
  });

  it('maps every enum value to the actual in-container path', () => {
    // Confirmed against Dockerfile.allinone:
    //   line 139 / 544 → nginx config at /etc/nginx/http.d/default.conf
    //   line 205 / 547 → supervisor config at /etc/supervisor.d/raid-ledger.ini
    expect(TARGET_TO_PATH['nginx-conf']).toBe('/etc/nginx/http.d/default.conf');
    expect(TARGET_TO_PATH['supervisor-conf']).toBe(
      '/etc/supervisor.d/raid-ledger.ini',
    );
  });

  it('Zod enum schema rejects unknown target strings', () => {
    expect(() => EnvInspectTargetSchema.parse('made-up')).toThrow();
    expect(() => EnvInspectTargetSchema.parse('')).toThrow();
    expect(() => EnvInspectTargetSchema.parse(null)).toThrow();
    expect(() => EnvInspectTargetSchema.parse('nginx-conf')).not.toThrow();
    expect(() => EnvInspectTargetSchema.parse('supervisor-conf')).not.toThrow();
  });

  it('Zod params schema enforces slug regex (a-z0-9-, 1-63 chars)', () => {
    expect(
      EnvInspectParamsSchema.safeParse({ slug: 'good-slug', what: 'nginx-conf' })
        .success,
    ).toBe(true);
    expect(
      EnvInspectParamsSchema.safeParse({ slug: '', what: 'nginx-conf' }).success,
    ).toBe(false);
    expect(
      EnvInspectParamsSchema.safeParse({ slug: 'UPPER', what: 'nginx-conf' })
        .success,
    ).toBe(false);
    expect(
      EnvInspectParamsSchema.safeParse({
        slug: 'has space',
        what: 'nginx-conf',
      }).success,
    ).toBe(false);
    expect(
      EnvInspectParamsSchema.safeParse({
        slug: 'a'.repeat(64),
        what: 'nginx-conf',
      }).success,
    ).toBe(false);
    // Shell metachars must not pass — the slug is interpolated directly into
    // the container name after Zod, and the regex is the only gate.
    expect(
      EnvInspectParamsSchema.safeParse({
        slug: 'bad;rm',
        what: 'nginx-conf',
      }).success,
    ).toBe(false);
    expect(
      EnvInspectParamsSchema.safeParse({
        slug: 'bad$(id)',
        what: 'nginx-conf',
      }).success,
    ).toBe(false);
  });
});

describe('rl_env_inspect — execute()', () => {
  it('SSHes the VM with DOCKER_HOST-routed `docker exec <container> cat <path>` for nginx-conf', async () => {
    execFileOk('server { listen 80; }\n');
    const result = await execute({ slug: 'myenv', what: 'nginx-conf' });
    expect(result.ok).toBe(true);
    expect(result.slug).toBe('myenv');
    expect(result.what).toBe('nginx-conf');
    expect(result.container).toBe('rl-env-myenv-allinone');
    expect(result.path).toBe('/etc/nginx/http.d/default.conf');
    expect(result.content).toBe('server { listen 80; }\n');
    expect(result.bytes).toBe('server { listen 80; }\n'.length);
    expect(result.truncated).toBe(false);
    const call = mockExecFile.mock.calls[0];
    expect(call[0]).toBe('ssh');
    const remote = String(call[1].at(-1));
    // Mirrors infra-logs proxy routing: rl-agent is NOT in docker group, so
    // route via rl-docker-proxy at loopback 2375 (whitelisted for docker exec).
    expect(remote).toBe(
      'DOCKER_HOST=tcp://127.0.0.1:2375 docker exec rl-env-myenv-allinone cat /etc/nginx/http.d/default.conf 2>&1',
    );
  });

  it('SSHes the VM with the supervisor-conf path for what:supervisor-conf', async () => {
    execFileOk('[program:nginx]\ncommand=nginx\n');
    const result = await execute({ slug: 'other', what: 'supervisor-conf' });
    expect(result.ok).toBe(true);
    expect(result.what).toBe('supervisor-conf');
    expect(result.path).toBe('/etc/supervisor.d/raid-ledger.ini');
    expect(result.container).toBe('rl-env-other-allinone');
    const remote = String(mockExecFile.mock.calls[0][1].at(-1));
    expect(remote).toContain('rl-env-other-allinone');
    expect(remote).toContain('cat /etc/supervisor.d/raid-ledger.ini');
    expect(remote.startsWith('DOCKER_HOST=tcp://127.0.0.1:2375 ')).toBe(true);
  });

  it('uses the standard SSH argv (BatchMode + ConnectTimeout)', async () => {
    execFileOk('x');
    await execute({ slug: 'env1', what: 'nginx-conf' });
    const argv = mockExecFile.mock.calls[0][1] as string[];
    expect(argv).toContain('-o');
    expect(argv).toContain('BatchMode=yes');
    expect(argv).toContain('ConnectTimeout=5');
  });

  it('rejects unknown enum value at the executor boundary (defense-in-depth)', async () => {
    const result = await execute({
      slug: 'myenv',
      what: 'random-config' as unknown as 'nginx-conf',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_params');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('rejects empty slug at the executor boundary', async () => {
    const result = await execute({
      slug: '',
      what: 'nginx-conf',
    } as unknown as Parameters<typeof execute>[0]);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_params');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('rejects slugs that contain shell metachars at the executor boundary', async () => {
    const result = await execute({
      slug: 'evil;rm -rf /',
      what: 'nginx-conf',
    } as unknown as Parameters<typeof execute>[0]);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_params');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('returns env_not_found when docker reports "No such container"', async () => {
    execFileFail('Error response from daemon: No such container: rl-env-ghost-allinone\n', 1);
    const result = await execute({ slug: 'ghost', what: 'nginx-conf' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('env_not_found');
    expect(result.slug).toBe('ghost');
    expect(result.message).toContain('No such container');
  });

  it('returns config_file_not_found when cat reports "No such file"', async () => {
    execFileFail('cat: /etc/nginx/http.d/default.conf: No such file or directory\n', 1);
    const result = await execute({ slug: 'myenv', what: 'nginx-conf' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('config_file_not_found');
    expect(result.path).toBe('/etc/nginx/http.d/default.conf');
    expect(result.message).toContain('No such file');
  });

  it('returns truncated:true with partial bytes on maxBuffer overflow', async () => {
    mockExecFile.mockImplementationOnce(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        const callback = typeof _opts === 'function' ? (_opts as typeof cb) : cb;
        const partial = 'first-chunk\nsecond-chunk\n';
        const err = Object.assign(new Error('stdout maxBuffer length exceeded'), {
          code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
          stdout: partial,
          stderr: '',
        });
        callback(err, partial, '');
      },
    );
    const result = await execute({ slug: 'myenv', what: 'supervisor-conf' });
    expect(result.ok).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.content).toBe('first-chunk\nsecond-chunk\n');
    expect(result.bytes).toBe('first-chunk\nsecond-chunk\n'.length);
  });

  it('falls back to env_inspect_failed for generic SSH failure with synthesized diagnostic on empty stderr', async () => {
    execFileFail('', 255);
    const result = await execute({ slug: 'myenv', what: 'nginx-conf' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('env_inspect_failed');
    expect(result.slug).toBe('myenv');
    // Empty stderr triggers the diagnostic helper from exec.ts.
    expect(result.message).toContain('mcp-rl-fleet');
    expect(result.message).toContain('255');
  });

  it('returns ssh_unreachable on Connection refused (ROK-1338 PR-3)', async () => {
    execFileFail('ssh: connect to host rl-infra port 22: Connection refused', 255);
    const result = await execute({ slug: 'myenv', what: 'supervisor-conf' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('ssh_unreachable');
    expect(result.message).toContain('Connection refused');
  });

  it('returns ssh_denied on Permission denied (publickey) (ROK-1338 PR-3)', async () => {
    execFileFail('rl-agent@rl-infra: Permission denied (publickey).', 255);
    const result = await execute({ slug: 'myenv', what: 'supervisor-conf' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('ssh_denied');
    expect(result.hint).toMatch(/post-ROK-1338|MCP tools/);
  });
});

describe('rl_env_inspect — dogfood #4 unknown-key rejection', () => {
  it('rejects worktree_path (silent-strip would otherwise hide it)', async () => {
    const result = await execute({
      slug: 'myslug',
      what: 'nginx-conf',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      worktree_path: '/Users/sdodge/foo',
    } as any);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('unknown_param');
    expect(result.message).toContain('worktree_path');
  });
});
