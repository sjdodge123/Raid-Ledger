// ROK-1466 — rl_validate_ci forwards `fleet` and `base_url` to validate-ci.sh.
//
// Two pure seams, no SSH:
//   * resolveArgs turns the `fleet` boolean into --fleet (same contract the
//     ROK-1467 booleans already follow).
//   * resolveInnerEnv builds the `KEY=value ` prefix that binds the runner's
//     e2e target. This is the half that actually fixes ROK-1466: exporting only
//     one of BASE_URL / API_URL / HEALTH_URL let validate-ci probe the fleet env
//     and then run the suite against a localhost that has no listener inside the
//     runner container.
//   * sanitizeBaseUrl is the injection gate — the value is interpolated into a
//     remote shell command.
import { describe, it, expect } from 'vitest';
import {
  envForSlug,
  resolveArgs,
  resolveInnerEnv,
  sanitizeBaseUrl,
} from '../tools/validate-ci.js';

describe('rl_validate_ci resolveArgs — fleet', () => {
  it('maps fleet:true onto --fleet', () => {
    expect(resolveArgs({ fleet: true })).toEqual(['--fleet']);
  });

  it('composes --fleet with caller args, raw args first', () => {
    expect(resolveArgs({ args: ['--with-e2e'], fleet: true })).toEqual([
      '--with-e2e',
      '--fleet',
    ]);
  });

  it('does not duplicate --fleet when already passed raw', () => {
    expect(resolveArgs({ args: ['--fleet'], fleet: true })).toEqual(['--fleet']);
  });

  it('omits --fleet for false/undefined', () => {
    expect(resolveArgs({ fleet: false })).toEqual([]);
    expect(resolveArgs({})).toEqual([]);
  });
});

describe('sanitizeBaseUrl', () => {
  it('accepts an internal fleet-env hostname', () => {
    expect(sanitizeBaseUrl('http://rl-env-rok-1453-allinone')).toBe(
      'http://rl-env-rok-1453-allinone',
    );
  });

  it('accepts a slot subdomain over https', () => {
    expect(sanitizeBaseUrl('https://slot-3.gamernight.net')).toBe(
      'https://slot-3.gamernight.net',
    );
  });

  it('strips a trailing slash so <base>/api never doubles up', () => {
    expect(sanitizeBaseUrl('http://rl-env-x-allinone/')).toBe(
      'http://rl-env-x-allinone',
    );
  });

  it.each([
    'file:///etc/passwd',
    'http://host; rm -rf /',
    'http://host$(id)',
    'http://host`id`',
    'not-a-url',
    '',
  ])('rejects %s', (bad) => {
    expect(() => sanitizeBaseUrl(bad)).toThrow();
  });
});

describe('resolveInnerEnv', () => {
  const BASE = 'http://rl-env-rok-1453-allinone';

  it('is empty without a target so the default gate is unchanged', () => {
    expect(resolveInnerEnv({})).toBe('');
  });

  it('exports all three target vars, not just one', () => {
    const env = resolveInnerEnv({ baseUrl: BASE });
    expect(env).toContain(`BASE_URL='${BASE}'`);
    expect(env).toContain(`API_URL='${BASE}/api'`);
    expect(env).toContain(`HEALTH_URL='${BASE}/api/health'`);
    expect(env.endsWith(' ')).toBe(true);
  });

  it('appends ADMIN_PASSWORD only when one was seeded', () => {
    expect(resolveInnerEnv({ baseUrl: BASE })).not.toContain('ADMIN_PASSWORD');
    expect(resolveInnerEnv({ baseUrl: BASE, adminPassword: 'pw' })).toContain(
      "ADMIN_PASSWORD='pw'",
    );
  });

  it('shell-quotes a password containing metacharacters', () => {
    const env = resolveInnerEnv({ baseUrl: BASE, adminPassword: "a'b;c" });
    expect(env).not.toMatch(/ADMIN_PASSWORD=a'b;c /);
    expect(env).toContain('ADMIN_PASSWORD=');
  });
});

describe('envForSlug', () => {
  it('derives the internal allinone hostname from a slug', () => {
    expect(envForSlug('rok-1453')).toBe('http://rl-env-rok-1453-allinone');
  });
});
