// ROK-1793 S2 — the MCP half of the parallel fleet gate: refusals, the
// gate-fanout command shape and --exclude-slots from `mutagen sync list`.
import { describe, it, expect } from 'vitest';
import {
  GATE_FANOUT,
  buildFanoutCommand,
  busySlotsFromMutagen,
  parallelError,
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
const TARGET = { taskId: 'abcdef123456', ownerSlot: 1, args: ['--fleet'] };

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
  it('uses the injected lister and fails open to [] on error', async () => {
    expect(await busySlotsFromMutagen(async () => LISTING)).toEqual([1, 3]);
    expect(await busySlotsFromMutagen(async () => Promise.reject(new Error('no mutagen')))).toEqual([]);
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
    expect(cmd).toContain("--b-args '--only-e2e'");
    expect(cmd).toContain(`--serial-args ''\\''--fleet'\\'''`);
  });
  it('passes the inner env once, quoted', () => {
    expect(cmd).toContain(`--inner-env 'BASE_URL='\\''https://slot-1.gamernight.net'\\''`);
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

describe('parallelTarget', () => {
  it('refuses an ineligible request and an unclaimed caller', async () => {
    expect(await parallelTarget({ parallel: true }, 'abcdef123456', 1, ENV, [])).toMatchObject({
      error: 'invalid_parallel',
    });
    expect(
      await parallelTarget({ fleet: true, parallel: true }, 'abcdef123456', null, ENV, ['--fleet']),
    ).toMatchObject({ error: 'parallel_requires_claim' });
  });
  it('builds the command with the listed busy slots', async () => {
    const r = await parallelTarget({ fleet: true, parallel: true }, 'abcdef123456', 1, ENV, ['--fleet'], async () => LISTING);
    expect('cmd' in r && r.cmd).toContain("--exclude-slots '1,3'");
  });
});
