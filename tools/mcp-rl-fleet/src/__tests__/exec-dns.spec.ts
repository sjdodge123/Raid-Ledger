// ROK-1331 M6b HIGH-3 — DNS fallback for RL_PROXMOX_HOST.
// resolveProxmoxHost() should try DNS for `rl-infra.lan` (or whatever envHost
// is). On DNS failure (ENOTFOUND/EAI_AGAIN/timeout) it falls back to the
// RL_INFRA_IP loaded from the repo-root .env. Memoized for the MCP server
// lifetime so the first call bears the lookup cost ONCE.
//
// Companion: loadRlInfraIp() walks process.cwd() upward to find the repo
// root (adjacent .git dir) and parses a `RL_INFRA_IP=...` line out of the
// .env there.
//
// These tests MUST fail today — neither symbol exists in src/exec.ts yet.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Hoist the dns.promises mock so all imports of `node:dns` (including the SUT's
// transitive imports) see the stubbed module.
const dnsLookupMock = vi.hoisted(() => vi.fn());
vi.mock('node:dns', async () => {
  const actual = await vi.importActual<typeof import('node:dns')>('node:dns');
  return {
    ...actual,
    promises: { ...actual.promises, lookup: dnsLookupMock },
  };
});

// SUT — symbols do NOT exist yet; the import will resolve at runtime once
// the dev agent ships them.
import {
  resolveProxmoxHost,
  loadRlInfraIp,
  _resetResolveProxmoxHostCacheForTest,
} from '../exec.js';

describe('ROK-1331 M6b — resolveProxmoxHost() DNS fallback', () => {
  beforeEach(() => {
    dnsLookupMock.mockReset();
    // Reset the module-level memo between tests so each case sees a fresh
    // resolution. The exported test-only reset hook is intentional — keeps
    // the SUT's `cachedHost` non-exported in production.
    if (typeof _resetResolveProxmoxHostCacheForTest === 'function') {
      _resetResolveProxmoxHostCacheForTest();
    }
  });

  it('returns envHost when DNS resolves the candidate (source=dns)', async () => {
    dnsLookupMock.mockResolvedValueOnce({ address: '10.0.0.1', family: 4 });
    const out = await resolveProxmoxHost({ envHost: 'rl-infra.lan', fallbackIp: '192.168.0.132' });
    expect(out.host).toBe('rl-infra.lan');
    expect(out.source).toBe('dns');
    expect(dnsLookupMock).toHaveBeenCalledTimes(1);
    expect(dnsLookupMock).toHaveBeenCalledWith('rl-infra.lan');
  });

  it('returns fallbackIp when DNS fails with ENOTFOUND (source=ip-fallback)', async () => {
    const notFound: NodeJS.ErrnoException = new Error('getaddrinfo ENOTFOUND rl-infra.lan');
    notFound.code = 'ENOTFOUND';
    dnsLookupMock.mockRejectedValueOnce(notFound);
    const out = await resolveProxmoxHost({ envHost: 'rl-infra.lan', fallbackIp: '192.168.0.132' });
    expect(out.host).toBe('192.168.0.132');
    expect(out.source).toBe('ip-fallback');
  });

  it('returns fallbackIp when DNS fails with EAI_AGAIN', async () => {
    const transient: NodeJS.ErrnoException = new Error('getaddrinfo EAI_AGAIN');
    transient.code = 'EAI_AGAIN';
    dnsLookupMock.mockRejectedValueOnce(transient);
    const out = await resolveProxmoxHost({ envHost: 'rl-infra.lan', fallbackIp: '192.168.0.132' });
    expect(out.host).toBe('192.168.0.132');
    expect(out.source).toBe('ip-fallback');
  });

  it('throws when DNS fails AND no fallbackIp is provided', async () => {
    const notFound: NodeJS.ErrnoException = new Error('getaddrinfo ENOTFOUND rl-infra.lan');
    notFound.code = 'ENOTFOUND';
    dnsLookupMock.mockRejectedValueOnce(notFound);
    await expect(
      resolveProxmoxHost({ envHost: 'rl-infra.lan', fallbackIp: undefined }),
    ).rejects.toThrow(/Cannot resolve.*RL_INFRA_IP/i);
  });

  it('memoizes the result — second call does NOT re-invoke dns.lookup', async () => {
    dnsLookupMock.mockResolvedValueOnce({ address: '10.0.0.1', family: 4 });
    const first = await resolveProxmoxHost({ envHost: 'rl-infra.lan', fallbackIp: '192.168.0.132' });
    const second = await resolveProxmoxHost({ envHost: 'rl-infra.lan', fallbackIp: '192.168.0.132' });
    expect(first).toEqual(second);
    expect(dnsLookupMock).toHaveBeenCalledTimes(1);
  });

  it('memoizes ip-fallback verdicts too (cache covers the failure leg)', async () => {
    const notFound: NodeJS.ErrnoException = new Error('getaddrinfo ENOTFOUND rl-infra.lan');
    notFound.code = 'ENOTFOUND';
    dnsLookupMock.mockRejectedValueOnce(notFound);
    const first = await resolveProxmoxHost({ envHost: 'rl-infra.lan', fallbackIp: '192.168.0.132' });
    const second = await resolveProxmoxHost({ envHost: 'rl-infra.lan', fallbackIp: '192.168.0.132' });
    expect(first.host).toBe('192.168.0.132');
    expect(first.source).toBe('ip-fallback');
    expect(second).toEqual(first);
    expect(dnsLookupMock).toHaveBeenCalledTimes(1);
  });
});

describe('ROK-1331 M6b — loadRlInfraIp() walks cwd up to repo root', () => {
  let scratch: string;
  let origCwd: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'rl-loadenv-'));
    origCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(scratch, { recursive: true, force: true });
  });

  it('parses RL_INFRA_IP from .env in the discovered repo root', () => {
    // Lay out scratch/fakerepo/.git + .env, then chdir into a nested subdir.
    const repo = join(scratch, 'fakerepo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    writeFileSync(join(repo, '.env'), 'FOO=bar\nRL_INFRA_IP=192.168.0.132\nBAZ=qux\n', 'utf-8');
    const nested = join(repo, 'a', 'b', 'c');
    mkdirSync(nested, { recursive: true });
    process.chdir(nested);

    const out = loadRlInfraIp();
    expect(out).toBe('192.168.0.132');
  });

  it('returns undefined when .env is missing from the discovered repo root', () => {
    const repo = join(scratch, 'norepo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    process.chdir(repo);
    expect(loadRlInfraIp()).toBeUndefined();
  });

  it('returns undefined when .env exists but has no RL_INFRA_IP line', () => {
    const repo = join(scratch, 'norlip');
    mkdirSync(join(repo, '.git'), { recursive: true });
    writeFileSync(join(repo, '.env'), 'FOO=bar\nDATABASE_URL=postgres://...\n', 'utf-8');
    process.chdir(repo);
    expect(loadRlInfraIp()).toBeUndefined();
  });

  it('skips commented-out RL_INFRA_IP lines', () => {
    const repo = join(scratch, 'commented');
    mkdirSync(join(repo, '.git'), { recursive: true });
    writeFileSync(join(repo, '.env'), '# RL_INFRA_IP=10.0.0.5\nRL_INFRA_IP=192.168.0.132\n', 'utf-8');
    process.chdir(repo);
    expect(loadRlInfraIp()).toBe('192.168.0.132');
  });

  it('returns undefined when no ancestor .git dir is found (not a git repo)', () => {
    // Build a tree with NO .git anywhere on the path → loader must give up.
    const lonely = join(scratch, 'lonely', 'deep', 'path');
    mkdirSync(lonely, { recursive: true });
    process.chdir(lonely);
    expect(loadRlInfraIp()).toBeUndefined();
  });
});
