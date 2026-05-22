// ROK-1338 PR-1 — rl_infra_logs tests.
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
  INFRA_SERVICE_VALUES,
  SERVICE_TO_CONTAINER,
  InfraServiceSchema,
} from '../infra-logs.js';

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

describe('rl_infra_logs — enum + container mapping', () => {
  it('exposes the operator-locked 7-value service enum', () => {
    expect(INFRA_SERVICE_VALUES).toEqual([
      'gc-sweeper',
      'dashboard',
      'traefik',
      'loki',
      'registry',
      'promtail',
      'docker-proxy',
    ]);
  });

  it('maps every enum value to a `rl-*` container name', () => {
    for (const service of INFRA_SERVICE_VALUES) {
      expect(SERVICE_TO_CONTAINER[service]).toMatch(/^rl-/);
    }
    expect(SERVICE_TO_CONTAINER['gc-sweeper']).toBe('rl-gc-sweeper');
    expect(SERVICE_TO_CONTAINER['dashboard']).toBe('rl-dashboard');
    expect(SERVICE_TO_CONTAINER['traefik']).toBe('rl-traefik');
    expect(SERVICE_TO_CONTAINER['loki']).toBe('rl-loki');
    expect(SERVICE_TO_CONTAINER['registry']).toBe('rl-registry');
    expect(SERVICE_TO_CONTAINER['promtail']).toBe('rl-promtail');
    expect(SERVICE_TO_CONTAINER['docker-proxy']).toBe('rl-docker-proxy');
  });

  it('Zod enum schema rejects unknown service strings', () => {
    expect(() => InfraServiceSchema.parse('made-up')).toThrow();
    expect(() => InfraServiceSchema.parse('')).toThrow();
    expect(() => InfraServiceSchema.parse(null)).toThrow();
    expect(() => InfraServiceSchema.parse('gc-sweeper')).not.toThrow();
  });
});

describe('rl_infra_logs — execute()', () => {
  it('SSHes the VM with DOCKER_HOST-routed `docker logs --tail N --timestamps <container>`', async () => {
    execFileOk('line1\nline2\nline3\n');
    const result = await execute({ service: 'gc-sweeper', tail: 20 });
    expect(result.ok).toBe(true);
    expect(result.service).toBe('gc-sweeper');
    expect(result.container).toBe('rl-gc-sweeper');
    expect(result.lines).toEqual(['line1', 'line2', 'line3']);
    expect(result.truncated).toBe(false);
    const call = mockExecFile.mock.calls[0];
    expect(call[0]).toBe('ssh');
    // argv-array: the final element is the remote command string.
    const remote = String(call[1].at(-1));
    // ROK-1338 PR-1 dogfood-1: route via rl-docker-proxy (rl-agent isn't in
    // docker group; proxy whitelists GET /containers/[id]/logs).
    // codex P2 (2026-05-21): merge stderr→stdout (2>&1) on the remote side
    // to preserve temporal ordering between docker logs's two streams.
    expect(remote).toBe(
      'DOCKER_HOST=tcp://127.0.0.1:2375 docker logs --tail 20 --timestamps rl-gc-sweeper 2>&1',
    );
  });

  it('routes every service through the docker-proxy (DOCKER_HOST prefix)', async () => {
    for (const service of INFRA_SERVICE_VALUES) {
      execFileOk('');
      await execute({ service, tail: 1 });
      const remote = String(mockExecFile.mock.calls.at(-1)?.[1].at(-1));
      expect(remote.startsWith('DOCKER_HOST=tcp://127.0.0.1:2375 ')).toBe(true);
      expect(remote).toContain(`docker logs --tail 1 --timestamps ${SERVICE_TO_CONTAINER[service]}`);
    }
  });

  it('defaults tail to 100 when omitted', async () => {
    execFileOk('');
    await execute({ service: 'dashboard' });
    const remote = String(mockExecFile.mock.calls[0][1].at(-1));
    expect(remote).toContain('--tail 100');
    expect(remote).toContain('rl-dashboard');
  });

  it('rejects tail > 5000 at the executor boundary', async () => {
    const result = await execute({
      service: 'traefik',
      tail: 99999,
    } as unknown as Parameters<typeof execute>[0]);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_params');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('rejects negative tail', async () => {
    const result = await execute({
      service: 'traefik',
      tail: -5,
    } as unknown as Parameters<typeof execute>[0]);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_params');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('rejects non-integer tail (e.g. 12.5)', async () => {
    const result = await execute({
      service: 'traefik',
      tail: 12.5,
    } as unknown as Parameters<typeof execute>[0]);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_params');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('rejects unknown service enum', async () => {
    const result = await execute({
      service: 'fake-service' as unknown as 'gc-sweeper',
      tail: 10,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_params');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('merges stdout + stderr (docker logs splits across both streams)', async () => {
    execFileOk('stdout-line1\n', 'stderr-line1\nstderr-line2\n');
    const result = await execute({ service: 'gc-sweeper', tail: 5 });
    expect(result.ok).toBe(true);
    expect(result.lines).toEqual(['stdout-line1', 'stderr-line1', 'stderr-line2']);
  });

  it('returns container_not_found when docker says "No such container"', async () => {
    execFileFail('Error: No such container: rl-loki\n', 1);
    const result = await execute({ service: 'loki', tail: 10 });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('container_not_found');
    expect(result.container).toBe('rl-loki');
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
        const err = Object.assign(new Error('stdout maxBuffer length exceeded'), {
          code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
          stdout: 'partial-line1\npartial-line2\n',
          stderr: '',
        });
        callback(err, 'partial-line1\npartial-line2\n', '');
      },
    );
    const result = await execute({ service: 'traefik', tail: 5000 });
    expect(result.ok).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.lines).toEqual(['partial-line1', 'partial-line2']);
  });

  it('returns ssh_unreachable on Connection refused (ROK-1338 PR-3)', async () => {
    execFileFail(
      'ssh: connect to host rl-infra port 22: Connection refused',
      255,
    );
    const result = await execute({ service: 'registry', tail: 50 });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('ssh_unreachable');
    expect(result.message).toContain('Connection refused');
  });

  it('returns ssh_denied on Permission denied (publickey) (ROK-1338 PR-3)', async () => {
    execFileFail('rl-agent@rl-infra: Permission denied (publickey).', 255);
    const result = await execute({ service: 'registry', tail: 50 });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('ssh_denied');
  });

  it('maps docker-proxy → rl-docker-proxy (the dashed name)', async () => {
    execFileOk('');
    await execute({ service: 'docker-proxy', tail: 10 });
    const remote = String(mockExecFile.mock.calls[0][1].at(-1));
    expect(remote).toContain('rl-docker-proxy');
  });
});
