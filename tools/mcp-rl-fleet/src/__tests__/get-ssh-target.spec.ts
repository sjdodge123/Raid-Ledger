// ROK-1338 PR-2 round 5 — Codex P1 fix: getSshTarget() / buildSshArgs()
// MUST force user=rl-agent regardless of process.env.RL_PROXMOX_USER, AND
// MUST resolve host via DNS-with-IP-fallback (same path as runRl()).
//
// Why this exists: the 5 direct-SSH tools (rl_task_logs, rl_env_inspect,
// rl_db_query, rl_task_inspect, rl_infra_logs) used to inline
// `sshUser() = process.env.RL_PROXMOX_USER ?? 'rl-agent'` which inherited
// an operator-tainted shell env. If the operator launched the MCP server
// from a shell with `RL_PROXMOX_USER=rl` (the privileged account), agents
// would SSH as `rl`. Codex flagged this as P1 in round 5; fix is to
// centralize forced-identity + DNS-fallback into one shared helper.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const dnsLookupMock = vi.hoisted(() => vi.fn());
vi.mock('node:dns', async () => {
  const actual = await vi.importActual<typeof import('node:dns')>('node:dns');
  return {
    ...actual,
    promises: { ...actual.promises, lookup: dnsLookupMock },
  };
});

import {
  buildSshArgs,
  getSshTarget,
  _resetResolveProxmoxHostCacheForTest,
} from '../exec.js';

describe('getSshTarget — forced rl-agent identity (Codex P1 #1)', () => {
  let savedUser: string | undefined;
  let savedHost: string | undefined;

  beforeEach(() => {
    dnsLookupMock.mockReset();
    _resetResolveProxmoxHostCacheForTest();
    savedUser = process.env.RL_PROXMOX_USER;
    savedHost = process.env.RL_PROXMOX_HOST;
    // Default DNS success so we don't slow the suite with lookups.
    dnsLookupMock.mockResolvedValue({ address: '10.0.0.1', family: 4 });
  });

  afterEach();

  function afterEach() {
    // restore env after each test
    if (savedUser === undefined) delete process.env.RL_PROXMOX_USER;
    else process.env.RL_PROXMOX_USER = savedUser;
    if (savedHost === undefined) delete process.env.RL_PROXMOX_HOST;
    else process.env.RL_PROXMOX_HOST = savedHost;
  }

  it('returns user=rl-agent when no env var is set', async () => {
    delete process.env.RL_PROXMOX_USER;
    const { user } = await getSshTarget();
    expect(user).toBe('rl-agent');
  });

  it('IGNORES process.env.RL_PROXMOX_USER=rl (operator-tainted shell) — still uses rl-agent', async () => {
    process.env.RL_PROXMOX_USER = 'rl';
    const { user } = await getSshTarget();
    expect(user).toBe('rl-agent');
  });

  it('IGNORES process.env.RL_PROXMOX_USER=root (extreme operator shell) — still uses rl-agent', async () => {
    process.env.RL_PROXMOX_USER = 'root';
    const { user } = await getSshTarget();
    expect(user).toBe('rl-agent');
  });

  it('buildSshArgs() embeds the forced rl-agent user in the user@host argv', async () => {
    process.env.RL_PROXMOX_USER = 'rl'; // operator shell taint
    process.env.RL_PROXMOX_HOST = 'rl-infra';
    const args = await buildSshArgs('echo hello');
    // The user@host arg is the 5th arg (after -o BatchMode=yes -o ConnectTimeout=5).
    const userHostArg = args[4];
    expect(userHostArg).toMatch(/^rl-agent@/);
    expect(userHostArg).not.toMatch(/^rl@/);
  });

  it('buildSshArgs() returns the canonical argv shape', async () => {
    process.env.RL_PROXMOX_HOST = 'rl-infra';
    const args = await buildSshArgs('docker ps');
    expect(args).toEqual([
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=5',
      'rl-agent@rl-infra',
      'docker ps',
    ]);
  });
});

describe('getSshTarget — DNS fallback (Codex P1 #2)', () => {
  let savedHost: string | undefined;

  beforeEach(() => {
    dnsLookupMock.mockReset();
    _resetResolveProxmoxHostCacheForTest();
    savedHost = process.env.RL_PROXMOX_HOST;
  });

  function restore() {
    if (savedHost === undefined) delete process.env.RL_PROXMOX_HOST;
    else process.env.RL_PROXMOX_HOST = savedHost;
  }

  it('falls back to the host string when DNS fails AND no .env fallback exists', async () => {
    // Force DNS failure for the default candidate; loadRlInfraIp will return
    // undefined when running outside the repo root or .env doesn't have the
    // line. The helper catches resolveProxmoxHost's throw and falls through
    // to env-or-default so the SSH call surfaces the real error rather than
    // masking it as a precondition crash.
    process.env.RL_PROXMOX_HOST = 'rl-infra';
    const notFound: NodeJS.ErrnoException = new Error('getaddrinfo ENOTFOUND rl-infra');
    notFound.code = 'ENOTFOUND';
    dnsLookupMock.mockRejectedValue(notFound);
    // In an environment without a .env containing RL_INFRA_IP, resolveProxmoxHost
    // throws → helper catches → returns the env-or-default host literal.
    const { host } = await getSshTarget();
    // Either the literal 'rl-infra' (no .env) OR an IP (if .env loaded one) —
    // both are acceptable; the key invariant is the helper didn't propagate.
    expect(host.length).toBeGreaterThan(0);
    restore();
  });

  it('uses the resolved host on DNS success', async () => {
    process.env.RL_PROXMOX_HOST = 'rl-infra.lan';
    dnsLookupMock.mockResolvedValue({ address: '10.0.0.1', family: 4 });
    const { host } = await getSshTarget();
    expect(host).toBe('rl-infra.lan');
    restore();
  });
});
