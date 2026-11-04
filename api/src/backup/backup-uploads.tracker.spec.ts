/**
 * UploadsArchiveTracker — the in-memory record behind the backup list's
 * `uploadsArchive` state (504 fix). Real fs in a tmpdir: the restart case is
 * about which files exist, not about mocks.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { ConflictException } from '@nestjs/common';

import {
  ARCHIVE_RUNNING_MESSAGE,
  UploadsArchiveTracker,
} from './backup-uploads.tracker';
import { removeStalePartialArchives } from './backup-uploads.wiring';
import type { UploadsArchiveResult } from './backup-uploads.helpers';

const DUMP = 'raid_ledger_2026-11-04_100000.dump';
const TAR = 'raid_ledger_2026-11-04_100000.uploads.tar';
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-backup-504-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** The resolver of the `i`th archive started; throws if it never started. */
function started(
  finishers: Array<(r: UploadsArchiveResult) => void>,
  i: number,
): (r: UploadsArchiveResult) => void {
  const finish = finishers[i];
  if (!finish) throw new Error(`archive #${i + 1} never started`);
  return finish;
}

describe('UploadsArchiveTracker', () => {
  it('a second run for the same dump joins the running archive instead of starting another', async () => {
    const tracker = new UploadsArchiveTracker(dir);
    let finish: (r: UploadsArchiveResult) => void = () => undefined;
    const archive = jest.fn(
      () =>
        new Promise<UploadsArchiveResult>((resolve) => {
          finish = resolve;
        }),
    );
    const first = tracker.run(DUMP, archive);
    const second = tracker.run(DUMP, archive);
    expect(second).toBe(first);
    expect(archive).toHaveBeenCalledTimes(1);
    finish({ status: 'written', path: path.join(dir, TAR) });
    await expect(first).resolves.toEqual({
      status: 'written',
      path: path.join(dir, TAR),
    });
  });

  it('archives for DIFFERENT dumps run one at a time, each after the previous settles', async () => {
    const tracker = new UploadsArchiveTracker(dir);
    const finishers: Array<(r: UploadsArchiveResult) => void> = [];
    const archive = jest.fn(
      () =>
        new Promise<UploadsArchiveResult>((resolve) => {
          finishers.push(resolve);
        }),
    );
    const OTHER = 'raid_ledger_2026-11-04_100005.dump';
    void tracker.run(DUMP, archive);
    const second = tracker.run(OTHER, archive);
    await new Promise((resolve) => setImmediate(resolve));
    expect(archive).toHaveBeenCalledTimes(1);
    expect(tracker.stateOf(OTHER)).toEqual({ state: 'archiving' });

    started(finishers, 0)({ status: 'skipped', reason: 'missing-root' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(archive).toHaveBeenCalledTimes(2);
    started(finishers, 1)({ status: 'skipped', reason: 'missing-root' });
    await tracker.whenIdle();
    await expect(second).resolves.toEqual({
      status: 'skipped',
      reason: 'missing-root',
    });
    expect(tracker.stateOf(OTHER)).toBeUndefined();
  });
});

describe('UploadsArchiveTracker — failure copy', () => {
  it('a failure lists a fixed message per reason — never the raw detail with server paths', async () => {
    const tracker = new UploadsArchiveTracker(dir);
    await tracker.run(DUMP, () =>
      Promise.resolve<UploadsArchiveResult>({
        status: 'failed',
        reason: 'measure-failed',
        detail: "EACCES: permission denied, scandir '/data/uploads/hub-media'",
      }),
    );
    expect(tracker.stateOf(DUMP)).toEqual({
      state: 'failed',
      error: 'Could not measure the uploads folder — see server logs',
    });
    tracker.forget(DUMP);
    expect(tracker.stateOf(DUMP)).toBeUndefined();
  });
});

describe('UploadsArchiveTracker — after a restart', () => {
  it('after a restart, an archive cut short (only .partial on disk) is not listed as archiving or ready', () => {
    fs.writeFileSync(path.join(dir, `${TAR}.partial`), 'half');
    expect(new UploadsArchiveTracker(dir).stateOf(DUMP)).toBeUndefined();
  });

  it('after a restart, a finished archive on disk reads as ready with its size', () => {
    fs.writeFileSync(path.join(dir, TAR), 'abcd');
    expect(new UploadsArchiveTracker(dir).stateOf(DUMP)).toEqual({
      state: 'ready',
      sizeBytes: 4,
    });
  });
});

describe('removeStalePartialArchives (504 review MINOR 5)', () => {
  it('removes only *.uploads.tar.partial left by a restart', () => {
    for (const name of [`${TAR}.partial`, TAR, DUMP])
      fs.writeFileSync(path.join(dir, name), 'x');
    const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    removeStalePartialArchives(dir, logger);
    expect(fs.readdirSync(dir).sort()).toEqual([DUMP, TAR].sort());
  });
});

describe('UploadsArchiveTracker.exclusive — concurrent Create (504 review MINOR 14)', () => {
  it('a second Create while the first still dumps is a 409; the guard clears once it settles', async () => {
    const tracker = new UploadsArchiveTracker(dir);
    let finishDump: (name: string) => void = () => undefined;
    const dump = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          finishDump = resolve;
        }),
    );
    const first = tracker.exclusive(dump);
    await expect(tracker.exclusive(dump)).rejects.toThrow(
      new ConflictException(ARCHIVE_RUNNING_MESSAGE),
    );
    expect(dump).toHaveBeenCalledTimes(1);
    finishDump(DUMP);
    await expect(first).resolves.toBe(DUMP);
    await expect(
      tracker.exclusive(() => Promise.resolve('next')),
    ).resolves.toBe('next');
  });

  it('a dump that fails releases the guard', async () => {
    const tracker = new UploadsArchiveTracker(dir);
    await expect(
      tracker.exclusive(() => Promise.reject(new Error('pg_dump failed'))),
    ).rejects.toThrow('pg_dump failed');
    expect(() => tracker.assertIdle()).not.toThrow();
  });
});

describe('UploadsArchiveTracker — a rejected link never wedges the chain (504 review MINOR 15)', () => {
  it('when the failure path itself throws, the dump lists failed and the next archive still runs', async () => {
    const logger = {
      error: jest.fn(() => {
        throw new Error('logger down');
      }),
    };
    const tracker = new UploadsArchiveTracker(dir, logger);
    const first = tracker.run(DUMP, () => Promise.reject(new Error('boom')));
    const OTHER = 'raid_ledger_2026-11-04_100005.dump';
    const written: UploadsArchiveResult = {
      status: 'written',
      path: path.join(dir, 'other.uploads.tar'),
    };
    const second = tracker.run(OTHER, () => Promise.resolve(written));
    await expect(first).resolves.toMatchObject({
      status: 'failed',
      reason: 'tar-failed',
    });
    await expect(second).resolves.toEqual(written);
    expect(tracker.stateOf(DUMP)).toEqual({
      state: 'failed',
      error: 'Archive failed — see server logs',
    });
    expect(() => tracker.assertIdle()).not.toThrow();
  });

  it('lists a timed-out archive with its own fixed copy', async () => {
    const tracker = new UploadsArchiveTracker(dir);
    await tracker.run(DUMP, () =>
      Promise.resolve<UploadsArchiveResult>({
        status: 'failed',
        reason: 'timeout',
        detail: 'tar still running after 180 min — killed',
      }),
    );
    expect(tracker.stateOf(DUMP)).toEqual({
      state: 'failed',
      error: 'Archive took too long and was stopped — see server logs',
    });
  });
});
