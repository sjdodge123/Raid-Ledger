// ROK-1793 S2 — the MCP half of the parallel fleet gate: refusals, the
// gate-fanout command shape and --exclude-slots from `mutagen sync list`.
import { describe, it, expect } from 'vitest';
import {
  E2E_CHILD_ARGS,
  GATE_FANOUT,
  buildFanoutCommand,
  busySlotsFromMutagen,
  parallelError,
  parallelParentTimeout,
  parallelTarget,
  parseBusySlots,
} from '../validate-ci-parallel.js';

const LISTING = [
  '--------------------------------------------------------------------------------',
  'Name: rl-slot-3',
  'Identifier: sync_abc',
  'Alpha:',
  '\tURL: /Users/x/wt',
  '--------------------------------------------------------------------------------',
  'Name: other-session',
  '--------------------------------------------------------------------------------',
  'Name: rl-slot-1',
  'Name: rl-slot-3',
].join('\n');
const ENV = "BASE_URL='https://slot-1.gamernight.net' E2E_SCOPE='auto' ";
const TARGET = { taskId: 'abcdef123456', ownerSlot: 1, args: ['--fleet'], childTimeout: 5400 };

describe('parallelError', () => {
  it('accepts fleet:true + parallel:true', () => {
    expect(parallelError({ fleet: true, parallel: true })).toBeNull();
    expect(parallelError({})).toBeNull();
  });
  it('refuses parallel without fleet', () => {
    expect(parallelError({ parallel: true })).toMatch(/needs fleet:true/);
  });
  it('refuses modes with nothing to split', () => {
    expect(parallelError({ fleet: true, parallel: true, e2e_scope: 'none' })).toMatch(/e2e_scope/);
    expect(parallelError({ fleet: true, parallel: true, args: ['--no-e2e'] })).toMatch(/--no-e2e/);
    expect(parallelError({ fleet: true, parallel: true, args: ['--static'] })).toMatch(/--static/);
  });
  it('refuses fail_fast without parallel', () => {
    expect(parallelError({ fleet: true, fail_fast: true })).toMatch(/fail_fast/);
  });
});

describe('busy slots from mutagen', () => {
  it('parses rl-slot-N session names only, de-duplicated and sorted', () => {
    expect(parseBusySlots(LISTING)).toEqual([1, 3]);
  });
  it('uses the injected lister and returns null (unknown) when the listing fails (Codex r2 P1)', async () => {
    expect(await busySlotsFromMutagen(async () => LISTING)).toEqual([1, 3]);
    expect(await busySlotsFromMutagen(async () => Promise.reject(new Error('no mutagen')))).toBeNull();
  });
  it('returns null for output it cannot parse, [] only for an explicit no-sessions listing', async () => {
    expect(await busySlotsFromMutagen(async () => 'Error: unable to connect to daemon')).toBeNull();
    expect(await busySlotsFromMutagen(async () => '')).toBeNull();
    expect(await busySlotsFromMutagen(async () => '-----\nNo synchronization sessions found\n-----')).toEqual([]);
  });
});

describe('buildFanoutCommand', () => {
  const cmd = buildFanoutCommand({ fleet: true, parallel: true }, ENV, [1, 3], TARGET);
  it('runs gate-fanout for P on owner slot A', () => {
    expect(cmd.startsWith(`${GATE_FANOUT} 'abcdef123456' --owner-slot 1 `)).toBe(true);
  });
  it('excludes the Mutagen-busy slots', () => {
    expect(cmd).toContain("--exclude-slots '1,3'");
  });
  it('splits the gate: A = --fleet --no-e2e, B = --only-e2e, serial = the whole argv', () => {
    expect(cmd).toContain(`--a-args ''\\''--fleet'\\'' '\\''--no-e2e'\\'''`);
    expect(cmd).toContain(`--b-args ''\\''--only-e2e'\\'' '\\''--fleet-e2e'\\'''`);
    expect(cmd).toContain(`--serial-args ''\\''--fleet'\\'''`);
  });
  it('passes the inner env once, quoted', () => {
    expect(cmd).toContain(`--inner-env 'BASE_URL='\\''https://slot-1.gamernight.net'\\''`);
  });
  it('passes the child watchdog budget explicitly', () => {
    expect(cmd).toContain('--child-timeout 5400');
  });
  it('forwards E2E_SPECS in the shared inner env (gate-fanout strips it for child A only)', () => {
    const c = buildFanoutCommand({}, "E2E_SPECS='scripts/smoke/a.smoke.spec.ts' ", [], TARGET);
    expect(c).toContain(`--inner-env 'E2E_SPECS='\\''scripts/smoke/a.smoke.spec.ts'\\'' '`);
  });
  it('adds --fail-fast only when asked', () => {
    expect(cmd).not.toContain('--fail-fast');
    const ff = buildFanoutCommand({ fleet: true, parallel: true, fail_fast: true }, ENV, [], TARGET);
    expect(ff.endsWith(' --fail-fast')).toBe(true);
    expect(ff).toContain("--exclude-slots ''");
  });
  it('keeps extra caller args on child A and the serial fallback', () => {
    const c = buildFanoutCommand({}, ENV, [], { ...TARGET, args: ['--no-coverage', '--fleet'] });
    expect(c).toContain(`--a-args ''\\''--fleet'\\'' '\\''--no-e2e'\\'' '\\''--no-coverage'\\'''`);
  });
});

describe('e2e forcing (Codex r1 P2)', () => {
  it('B and C carry --fleet-e2e so they never diff-skip what serial --fleet runs', () => {
    expect(E2E_CHILD_ARGS).toEqual(['--only-e2e', '--fleet-e2e']);
  });
  it('strips --with-e2e / --fleet-e2e from child A (always --no-e2e) but keeps them on serial', () => {
    const c = buildFanoutCommand({}, ENV, [], { ...TARGET, args: ['--fleet', '--with-e2e', '--no-coverage'] });
    const aArgs = c.split('--a-args ')[1]?.split(' --b-args')[0] ?? '';
    expect(aArgs).not.toContain('--with-e2e');
    expect(aArgs).toContain('--no-coverage');
    expect(c.split('--serial-args ')[1]).toContain('--with-e2e');
  });
});

describe('caller flags reach the e2e children (Codex r2 P2)', () => {
  const bArgs = (c: string): string => c.split('--b-args ')[1]?.split(' --serial-args')[0] ?? '';
  const aArgs = (c: string): string => c.split('--a-args ')[1]?.split(' --b-args')[0] ?? '';
  it("forwards --ci to B (and so C) after B's own --only-e2e --fleet-e2e", () => {
    const c = buildFanoutCommand({}, ENV, [], { ...TARGET, args: ['--ci', '--fleet'] });
    expect(bArgs(c)).toBe(`''\\''--only-e2e'\\'' '\\''--fleet-e2e'\\'' '\\''--ci'\\'''`);
    expect(aArgs(c)).toContain('--ci');
  });
  it('forwards --with-e2e to B after --fleet-e2e (explicit wins) but never to A', () => {
    const c = buildFanoutCommand({}, ENV, [], { ...TARGET, args: ['--fleet', '--with-e2e'] });
    expect(bArgs(c)).toBe(`''\\''--only-e2e'\\'' '\\''--fleet-e2e'\\'' '\\''--with-e2e'\\'''`);
    expect(aArgs(c)).not.toContain('--with-e2e');
  });
});

describe('parallelTarget', () => {
  it('refuses an ineligible request and an unclaimed caller', async () => {
    expect(await parallelTarget({ parallel: true }, 'abcdef123456', 1, ENV, [], 5400)).toMatchObject({
      error: 'invalid_parallel',
    });
    expect(
      await parallelTarget({ fleet: true, parallel: true }, 'abcdef123456', null, ENV, ['--fleet'], 5400),
    ).toMatchObject({ error: 'parallel_requires_claim' });
  });
  it('builds the command with the listed busy slots', async () => {
    const r = await parallelTarget({ fleet: true, parallel: true }, 'abcdef123456', 1, ENV, ['--fleet'], 5400, async () => LISTING);
    expect('cmd' in r && r.cmd).toContain("--exclude-slots '1,3'");
    expect('cmd' in r && r.cmd).not.toContain('--force-serial');
  });
  it('forces the serial fallback when the listing throws (Codex r2 P1)', async () => {
    const r = await parallelTarget({ fleet: true, parallel: true }, 'abcdef123456', 1, ENV, ['--fleet'], 5400,
      async () => Promise.reject(new Error('timeout')));
    expect('cmd' in r && r.cmd).toContain("--force-serial 'slot enumeration failed'");
  });
  it('forces the serial fallback when the listing is unparsable', async () => {
    const r = await parallelTarget({ fleet: true, parallel: true }, 'abcdef123456', 1, ENV, ['--fleet'], 5400,
      async () => 'garbage');
    expect('cmd' in r && r.cmd).toContain("--force-serial 'slot enumeration failed'");
  });
});

describe('parallelParentTimeout', () => {
  it('with Discord possible: phase 1 + C (full child budget + 2700s lock wait) + 600 margin', () => {
    expect(parallelParentTimeout(5400, true)).toBe(5400 + 5400 + 2700 + 600);
    expect(parallelParentTimeout(1800, true)).toBe(1800 + 1800 + 2700 + 600);
  });
  it('without Discord: phase 1 + 600 margin', () => {
    expect(parallelParentTimeout(5400, false)).toBe(6000);
  });
  it("never exceeds task-start's 86400s ceiling", () => {
    expect(parallelParentTimeout(50_000, true)).toBe(86_400);
  });
});
