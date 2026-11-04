/**
 * 504 review MAJOR 13 — the uploads tar deadline. Fake timers drive the
 * defaults (UPLOADS_TAR_TIMEOUT_MS / UPLOADS_TAR_SLOW_WARN_MS); a runner that
 * never settles stands in for a hung tar. Real fs in a tmpdir for the
 * archiveUploads case: the partial must be gone after the kill.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as Sentry from '@sentry/nestjs';

import {
  runWithDeadline,
  TarTimeoutError,
  UPLOADS_TAR_SLOW_WARN_MS,
  UPLOADS_TAR_TIMEOUT_MS,
  type TarRunOptions,
} from './backup-uploads.deadline';
import { archiveUploads } from './backup-uploads.helpers';

jest.mock('@sentry/nestjs', () => ({
  ...jest.requireActual<object>('@sentry/nestjs'),
  captureMessage: jest.fn(),
}));

const captureMessage = jest.mocked(Sentry.captureMessage);
const hung = (): Promise<unknown> => new Promise(() => undefined);

function slowWarnings(): unknown[][] {
  return captureMessage.mock.calls.filter((c) => c[1] === 'warning');
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('runWithDeadline', () => {
  it('defaults to a 3 h kill and a 30 min warning', () => {
    expect(UPLOADS_TAR_TIMEOUT_MS).toBe(3 * 60 * 60 * 1000);
    expect(UPLOADS_TAR_SLOW_WARN_MS).toBe(30 * 60 * 1000);
  });

  it('a hung tar is aborted with SIGKILL at the deadline and rejects as a timeout', async () => {
    let seen: TarRunOptions | undefined;
    const run = runWithDeadline((opts) => {
      seen = opts;
      return hung();
    }, 'raid_ledger_ts.uploads.tar');
    const outcome = expect(run).rejects.toBeInstanceOf(TarTimeoutError);
    await jest.advanceTimersByTimeAsync(UPLOADS_TAR_TIMEOUT_MS - 1);
    expect(seen?.killSignal).toBe('SIGKILL');
    expect(seen?.signal.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await outcome;
    expect(seen?.signal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("reports execFile's own AbortError as the timeout", async () => {
    const run = runWithDeadline(
      ({ signal }) =>
        new Promise((_, reject) => {
          signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        }),
      'x.uploads.tar',
      { timeoutMs: 1_000 },
    );
    const outcome = expect(run).rejects.toBeInstanceOf(TarTimeoutError);
    await jest.advanceTimersByTimeAsync(1_000);
    await outcome;
  });
});

describe('runWithDeadline — slow warning and timers', () => {
  it('warns Sentry once after 30 min while the tar still runs', async () => {
    void runWithDeadline(hung, 'raid_ledger_ts.uploads.tar').catch(
      () => undefined,
    );
    await jest.advanceTimersByTimeAsync(UPLOADS_TAR_SLOW_WARN_MS - 1);
    expect(slowWarnings()).toEqual([]);
    await jest.advanceTimersByTimeAsync(1);
    expect(slowWarnings()).toEqual([
      [
        'uploads archive still running after 30 min (raid_ledger_ts.uploads.tar)',
        'warning',
      ],
    ]);
    await jest.advanceTimersByTimeAsync(UPLOADS_TAR_TIMEOUT_MS);
    expect(slowWarnings()).toHaveLength(1);
  });

  it('a tar that finishes clears both timers: no warning, no kill', async () => {
    let seen: TarRunOptions | undefined;
    await runWithDeadline((opts) => {
      seen = opts;
      return Promise.resolve();
    }, 'x.uploads.tar');
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(UPLOADS_TAR_TIMEOUT_MS);
    expect(slowWarnings()).toEqual([]);
    expect(seen?.signal.aborted).toBe(false);
  });

  it('a tar failure passes through unchanged', async () => {
    const err = Object.assign(new Error('bad'), { code: 2 });
    await expect(
      runWithDeadline(() => Promise.reject(err), 'x.uploads.tar'),
    ).rejects.toBe(err);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('archiveUploads with a hung tar', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-tar-deadline-'));
    fs.mkdirSync(path.join(tmp, 'uploads'));
    fs.mkdirSync(path.join(tmp, 'daily'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('fails as timeout and removes the partial', async () => {
    const outPath = path.join(tmp, 'daily', 'raid_ledger_ts.uploads.tar');
    let seen: TarRunOptions | undefined;
    const res = archiveUploads({
      uploadsDir: path.join(tmp, 'uploads'),
      outPath,
      dailyDir: path.dirname(outPath),
      warn: () => undefined,
      measure: () => 0,
      statfs: () => ({ bavail: Number.MAX_SAFE_INTEGER, bsize: 1 }),
      tarTimeoutMs: 5_000,
      runTar: (args, opts) => {
        seen = opts;
        fs.writeFileSync(args[1] ?? '', 'half');
        return hung();
      },
    });
    await jest.advanceTimersByTimeAsync(5_000);
    await expect(res).resolves.toEqual({
      status: 'failed',
      reason: 'timeout',
      detail: expect.stringMatching(/— killed$/),
    });
    expect(seen?.killSignal).toBe('SIGKILL');
    expect(seen?.signal.aborted).toBe(true);
    expect(fs.readdirSync(path.dirname(outPath))).toEqual([]);
  });
});
