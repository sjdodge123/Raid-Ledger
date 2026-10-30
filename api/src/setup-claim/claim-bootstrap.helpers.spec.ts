/**
 * ROK-1701 — boot-time claim arming (OQ-8a, D-13, D-14).
 *
 * The repository is mocked: these specs pin WHAT bootstrap stores and logs,
 * and above all that an env SETUP_CODE never reaches a log line.
 */
import type { ClaimDb, ClaimState } from './claim-state.repository';
import { CLAIM_CODE_PATTERN, hashClaimCode } from './claim-code.helpers';
import {
  armClaimOnBoot,
  formatClaimLogLine,
  runCloudClaimStep,
  type BootOut,
} from './claim-bootstrap.helpers';

const mockRead = jest.fn<Promise<ClaimState>, unknown[]>();
const mockArm = jest.fn<Promise<void>, unknown[]>();
const mockMarkClaimed = jest.fn<Promise<void>, unknown[]>();
jest.mock('./claim-state.repository', () => ({
  readClaimState: (...a: unknown[]) => mockRead(...a),
  armClaim: (...a: unknown[]) => mockArm(...a),
  markClaimed: (...a: unknown[]) => mockMarkClaimed(...a),
}));

const mockCapture = jest.fn();
const mockFlush = jest.fn(() => Promise.resolve(true));
jest.mock('@sentry/nestjs', () => ({
  captureException: (...a: unknown[]) => mockCapture(...a) as unknown,
  flush: (...a: unknown[]) => mockFlush(...(a as [])),
}));

const db = {} as ClaimDb;
const NOW = new Date('2026-10-30T12:00:00.000Z');
const EXPIRY = '2026-11-02T12:00:00.000Z';
const ENV_CODE = 'my-own-very-long-setup-code-value';

const lines: string[] = [];
const out: BootOut = {
  log: (l) => lines.push(`log|${l}`),
  warn: (l) => lines.push(`warn|${l}`),
  error: (l) => lines.push(`error|${l}`),
};

function unclaimed(): ClaimState {
  return { codeHash: null, expiresAt: null, claimedAt: null };
}

/** The `{codeHash, expiresAt}` of the Nth armClaim call, ISO-rendered. */
function armedWith(call: number): { codeHash: unknown; expiresAt: string } {
  const arg = mockArm.mock.calls[call]?.[1] as
    { codeHash: string; expiresAt: Date } | undefined;
  return {
    codeHash: arg?.codeHash ?? '<not armed>',
    expiresAt: arg?.expiresAt.toISOString() ?? '<not armed>',
  };
}

beforeEach(() => {
  lines.length = 0;
  jest.clearAllMocks();
  mockRead.mockResolvedValue(unclaimed());
  mockArm.mockResolvedValue(undefined);
  mockMarkClaimed.mockResolvedValue(undefined);
});

describe('formatClaimLogLine', () => {
  it('prints a generated code in the sheet format', () => {
    expect(
      formatClaimLogLine({ kind: 'generated', code: 'ABCD-EFGH-JKLM-NPQR' }),
    ).toBe('Setup code: ABCD-EFGH-JKLM-NPQR (open /claim)');
  });

  it('never prints an env code — names its source instead', () => {
    expect(formatClaimLogLine({ kind: 'env' })).toBe(
      'Setup code: from SETUP_CODE (open /claim)',
    );
  });
});

describe('armClaimOnBoot', () => {
  it('claimed instance → no arm, logs already claimed', async () => {
    mockRead.mockResolvedValue({ ...unclaimed(), claimedAt: NOW });

    const kind = await armClaimOnBoot(db, { SETUP_CODE: ENV_CODE }, NOW, out);

    expect(kind).toBe('claimed');
    expect(mockArm).not.toHaveBeenCalled();
    expect(lines).toEqual(['log|bootstrap-admin: instance already claimed']);
  });

  it('env SETUP_CODE → stores its hash with a 72h window, never logs it', async () => {
    const kind = await armClaimOnBoot(db, { SETUP_CODE: ENV_CODE }, NOW, out);

    expect(kind).toBe('env');
    expect(armedWith(0)).toEqual({
      codeHash: hashClaimCode(ENV_CODE),
      expiresAt: EXPIRY,
    });
    expect(lines).toEqual(['log|Setup code: from SETUP_CODE (open /claim)']);
    expect(lines.filter((l) => l.includes(ENV_CODE))).toEqual([]);
  });

  it('same env code on a second boot re-arms the SAME hash with a fresh window', async () => {
    await armClaimOnBoot(db, { SETUP_CODE: ENV_CODE }, NOW, out);
    const later = new Date(NOW.getTime() + 60 * 60 * 1000);
    await armClaimOnBoot(db, { SETUP_CODE: ENV_CODE }, later, out);

    expect(armedWith(1)).toEqual({
      codeHash: hashClaimCode(ENV_CODE),
      expiresAt: '2026-11-02T13:00:00.000Z',
    });
  });

  it('short env code → warns without echoing the value', async () => {
    await armClaimOnBoot(db, { SETUP_CODE: 'short1' }, NOW, out);

    expect(lines).toEqual([
      'log|Setup code: from SETUP_CODE (open /claim)',
      'warn|SETUP_CODE is short; use a long random value',
    ]);
    expect(lines.filter((l) => l.includes('short1'))).toEqual([]);
  });

  it('no env code → generates, stores its hash and logs it once', async () => {
    const kind = await armClaimOnBoot(db, {}, NOW, out);

    expect(kind).toBe('generated');
    const match = /^log\|Setup code: (\S+) \(open \/claim\)$/.exec(
      lines[0] ?? '',
    );
    const code = match?.[1] ?? '<no code line>';
    expect(code).toMatch(CLAIM_CODE_PATTERN);
    expect(lines).toHaveLength(1);
    expect(armedWith(0)).toEqual({
      codeHash: hashClaimCode(code),
      expiresAt: EXPIRY,
    });
  });

  it('no env code → a NEW code on every boot', async () => {
    await armClaimOnBoot(db, { SETUP_CODE: '  ' }, NOW, out);
    await armClaimOnBoot(db, {}, NOW, out);

    expect(armedWith(0).codeHash).not.toBe(armedWith(1).codeHash);
  });
});

describe('runCloudClaimStep', () => {
  it('normal boot on an unclaimed instance → armed', async () => {
    const outcome = await runCloudClaimStep(
      db,
      { resetMode: false, env: {}, now: NOW },
      out,
    );

    expect(outcome).toEqual({ armed: true, failed: false });
  });

  it('claimed instance → not armed, not failed', async () => {
    mockRead.mockResolvedValue({ ...unclaimed(), claimedAt: NOW });

    const outcome = await runCloudClaimStep(
      db,
      { resetMode: false, env: {}, now: NOW },
      out,
    );

    expect(outcome).toEqual({ armed: false, failed: false });
  });

  it('D-14: RESET_PASSWORD on an unclaimed instance closes the claim, arms nothing', async () => {
    const outcome = await runCloudClaimStep(
      db,
      { resetMode: true, env: { SETUP_CODE: ENV_CODE }, now: NOW },
      out,
    );

    expect(outcome).toEqual({ armed: false, failed: false });
    expect(mockArm).not.toHaveBeenCalled();
    expect(mockMarkClaimed).toHaveBeenCalledWith(db, NOW);
    expect(lines).toEqual([
      'log|bootstrap-admin: RESET_PASSWORD closed the setup claim',
    ]);
  });

  it('D-14: RESET_PASSWORD on a claimed instance leaves claimed_at alone', async () => {
    mockRead.mockResolvedValue({ ...unclaimed(), claimedAt: NOW });

    await runCloudClaimStep(db, { resetMode: true, env: {}, now: NOW }, out);

    expect(mockMarkClaimed).not.toHaveBeenCalled();
  });

  it('D-13: arm throws → Sentry capture then flush(2000), failed, no code logged', async () => {
    const boom = new Error('db down');
    mockArm.mockRejectedValue(boom);

    const outcome = await runCloudClaimStep(
      db,
      { resetMode: false, env: { SETUP_CODE: ENV_CODE }, now: NOW },
      out,
    );

    expect(outcome).toEqual({ armed: false, failed: true });
    expect(mockCapture).toHaveBeenCalledWith(boom, {
      tags: { context: 'boot.claim-arm' },
    });
    expect(mockFlush).toHaveBeenCalledWith(2000);
    expect(mockCapture.mock.invocationCallOrder[0]).toBeLessThan(
      mockFlush.mock.invocationCallOrder[0] ?? 0,
    );
    expect(lines).toEqual([
      'error|bootstrap-admin: setup claim could not be armed (db down); falling back to the admin banner',
    ]);
  });
});
