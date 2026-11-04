/**
 * UploadsArchiveTracker — the in-memory record behind the backup list's
 * `uploadsArchive` state (504 fix). Real fs in a tmpdir: the restart case is
 * about which files exist, not about mocks.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { UploadsArchiveTracker } from './backup-uploads.tracker';
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
