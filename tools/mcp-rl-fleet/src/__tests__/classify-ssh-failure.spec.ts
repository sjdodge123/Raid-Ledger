// ROK-1338 PR-3 — classifySshFailure helper unit tests.
//
// Pure-function classifier — pins the regex bucketing across:
//   - denied: Permission denied (publickey | publickey,password | try again),
//             Host key verification failed
//   - unreachable: Connection refused / timed out / closed by host port 22 /
//             No route to host / ssh: connect to host... / Could not resolve
//   - null: empty stderr, postgres errors, docker errors, exit 0
//
// Spec: planning-artifacts/specs/ROK-1338-error-hints.md §B0.

import { describe, it, expect } from 'vitest';
import { classifySshFailure } from '../exec.js';

describe('classifySshFailure — denied bucket', () => {
  it('matches Permission denied (publickey)', () => {
    const r = classifySshFailure(255, 'rl-agent@rl-infra: Permission denied (publickey).');
    expect(r?.error).toBe('ssh_denied');
    expect(r?.hint).toMatch(/post-ROK-1338|MCP tools/);
  });
  it('matches Permission denied (publickey,password)', () => {
    const r = classifySshFailure(255, 'Permission denied (publickey,password).');
    expect(r?.error).toBe('ssh_denied');
  });
  it('matches Permission denied, please try again', () => {
    const r = classifySshFailure(255, 'Permission denied, please try again.');
    expect(r?.error).toBe('ssh_denied');
  });
  it('matches Host key verification failed', () => {
    const r = classifySshFailure(255, 'Host key verification failed.');
    expect(r?.error).toBe('ssh_denied');
  });
});

describe('classifySshFailure — DENIED_RE tightening (ROK-1360)', () => {
  // The parenthesised denied branch now REQUIRES an OpenSSH auth-method token
  // inside the parens, so postgres-side `permission denied` text can't be
  // mis-bucketed as ssh_denied.
  it('does NOT classify postgres `permission denied for table users` as ssh_denied', () => {
    expect(
      classifySshFailure(1, 'ERROR:  permission denied for table users'),
    ).toBeNull();
  });
  it('does NOT classify postgres-style `permission denied (relation foo)` as ssh_denied', () => {
    // Parens present but NO auth method inside — must not match.
    expect(classifySshFailure(1, 'permission denied (relation foo)')).toBeNull();
  });
  it('still classifies Permission denied (publickey,password) as ssh_denied', () => {
    const r = classifySshFailure(255, 'Permission denied (publickey,password).');
    expect(r?.error).toBe('ssh_denied');
  });
  it('still classifies Permission denied (gssapi-keyex,gssapi-with-mic) as ssh_denied', () => {
    const r = classifySshFailure(255, 'Permission denied (gssapi-keyex,gssapi-with-mic).');
    expect(r?.error).toBe('ssh_denied');
  });
});

describe('classifySshFailure — UNREACHABLE_RE tightening (ROK-1360)', () => {
  // Bare `Connection refused` / `Connection timed out` is now anchored to the
  // OpenSSH `ssh: connect to host ... port N:` preamble so psql-side
  // connection errors can't be mis-bucketed as ssh_unreachable.
  it('does NOT classify psql `connection to server ... Connection refused` as ssh_unreachable', () => {
    expect(
      classifySshFailure(
        2,
        'psql: error: connection to server at "db" (127.0.0.1), port 5432 failed: Connection refused',
      ),
    ).toBeNull();
  });
  it('does NOT classify a bare `Connection timed out` (no ssh preamble) as ssh_unreachable', () => {
    expect(classifySshFailure(2, 'connection to server failed: Connection timed out')).toBeNull();
  });
  it('still classifies ssh: connect to host X port 22: Connection refused as ssh_unreachable', () => {
    const r = classifySshFailure(
      255,
      'ssh: connect to host rl-infra port 22: Connection refused',
    );
    expect(r?.error).toBe('ssh_unreachable');
  });
  it('still classifies ssh: connect to host X port 22: Connection timed out as ssh_unreachable', () => {
    const r = classifySshFailure(
      255,
      'ssh: connect to host 192.168.0.132 port 22: Connection timed out',
    );
    expect(r?.error).toBe('ssh_unreachable');
  });
});

describe('classifySshFailure — unreachable bucket', () => {
  it('matches Connection refused', () => {
    const r = classifySshFailure(
      255,
      'ssh: connect to host rl-infra port 22: Connection refused',
    );
    expect(r?.error).toBe('ssh_unreachable');
  });
  it('matches Connection timed out', () => {
    const r = classifySshFailure(
      255,
      'ssh: connect to host 192.168.0.132 port 22: Connection timed out',
    );
    expect(r?.error).toBe('ssh_unreachable');
  });
  it('matches Connection closed by host port 22', () => {
    const r = classifySshFailure(255, 'Connection closed by 192.168.0.132 port 22');
    expect(r?.error).toBe('ssh_unreachable');
  });
  it('matches No route to host', () => {
    const r = classifySshFailure(
      255,
      'ssh: connect to host rl-infra port 22: No route to host',
    );
    expect(r?.error).toBe('ssh_unreachable');
  });
  it('matches Could not resolve hostname', () => {
    const r = classifySshFailure(
      255,
      'ssh: Could not resolve hostname rl-infra: nodename nor servname provided',
    );
    expect(r?.error).toBe('ssh_unreachable');
  });
});

describe('classifySshFailure — null bucket', () => {
  it('returns null on empty stderr', () => {
    expect(classifySshFailure(255, '')).toBeNull();
  });
  it('returns null on postgres syntax error', () => {
    expect(classifySshFailure(3, 'ERROR:  syntax error at or near "FOO"')).toBeNull();
  });
  it('returns null on docker no-such-container error', () => {
    expect(
      classifySshFailure(
        1,
        'Error response from daemon: No such container: rl-env-x-allinone',
      ),
    ).toBeNull();
  });
  it('returns null on exit 0 with any stderr', () => {
    expect(classifySshFailure(0, 'irrelevant')).toBeNull();
  });
});
