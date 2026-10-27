/**
 * ROK-2023 (spec D10b/D11) — keep only the newest N `raid_ledger_*.uploads.tar`
 * archives in daily/. Real files in a tmpdir: the rotation is fs-only.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  rotateMigrationDir,
  rotateUploadsArchives,
} from './backup-rotation.helpers';

const DAY_MS = 86_400_000;
const BASE_MS = Date.UTC(2026, 9, 1);

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-uploads-rotation-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Write `name` with mtime BASE + `ageRank` days (higher rank = newer). */
function touch(name: string, ageRank: number): string {
  const filepath = path.join(dir, name);
  fs.writeFileSync(filepath, 'x');
  const when = new Date(BASE_MS + ageRank * DAY_MS);
  fs.utimesSync(filepath, when, when);
  return filepath;
}

const archive = (day: number): string =>
  `raid_ledger_2026-10-${String(day).padStart(2, '0')}_020010.uploads.tar`;

const remaining = (): string[] => fs.readdirSync(dir).sort();

describe('rotateUploadsArchives', () => {
  it('keeps the 7 newest archives by mtime and unlinks the rest', () => {
    // Name order deliberately differs from mtime order: day 01 is the NEWEST.
    const ranks = [9, 0, 1, 2, 3, 4, 5, 6, 7];
    ranks.forEach((rank, i) => touch(archive(i + 1), rank));
    const warn = jest.fn();

    const removed = rotateUploadsArchives(dir, 7, warn);

    expect(removed).toBe(2);
    expect(remaining()).not.toContain(archive(2)); // rank 0 — oldest
    expect(remaining()).not.toContain(archive(3)); // rank 1
    expect(remaining()).toContain(archive(1)); // newest despite its name
    expect(warn).not.toHaveBeenCalled();
  });

  it('never touches dumps, other files or symlinks that look like archives', () => {
    for (let day = 1; day <= 8; day++) touch(archive(day), day);
    touch('raid_ledger_2026-09-01_020010.dump', -30);
    touch('raid_ledger_notes.txt', -30);
    touch('other.uploads.tar', -30);
    const target = touch('elsewhere.bin', -30);
    fs.symlinkSync(target, path.join(dir, 'raid_ledger_link.uploads.tar'));

    const removed = rotateUploadsArchives(dir, 7, jest.fn());

    expect(removed).toBe(1);
    expect(remaining()).toEqual(
      [
        ...[2, 3, 4, 5, 6, 7, 8].map(archive),
        'elsewhere.bin',
        'other.uploads.tar',
        'raid_ledger_2026-09-01_020010.dump',
        'raid_ledger_link.uploads.tar',
        'raid_ledger_notes.txt',
      ].sort(),
    );
  });

  it('removes nothing with 7 or fewer archives', () => {
    for (let day = 1; day <= 7; day++) touch(archive(day), day);
    expect(rotateUploadsArchives(dir, 7, jest.fn())).toBe(0);
    expect(remaining()).toHaveLength(7);
  });

  it('warns and returns 0 on an unreadable directory (never throws)', () => {
    const warn = jest.fn();
    const missing = path.join(dir, 'nope');
    expect(rotateUploadsArchives(missing, 7, warn)).toBe(0);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(`cannot read ${missing}`),
    );
  });

  it('leaves pre_migration_ rotation scoped to its own files', () => {
    for (let day = 1; day <= 3; day++) touch(archive(day), day);
    touch('pre_migration_2026-10-01_020000.dump', 1);
    touch('pre_migration_2026-10-02_020000.dump', 2);
    expect(rotateMigrationDir(dir, 1, jest.fn())).toBe(1);
    expect(remaining()).toEqual(
      [
        ...[1, 2, 3].map(archive),
        'pre_migration_2026-10-02_020000.dump',
      ].sort(),
    );
  });
});
