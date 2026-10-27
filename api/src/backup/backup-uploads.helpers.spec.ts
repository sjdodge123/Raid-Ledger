/**
 * ROK-2023 L1 — uploads-archive helpers. Pure functions plus a real `tar`
 * round-trip in a tmpdir (no DB).
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  archiveUploads,
  hasRoomFor,
  isTarFatal,
  measureTree,
  resolveUploadsDir,
  tarCreateArgs,
  uploadsArchiveName,
  UPLOADS_RESERVE_BYTES,
} from './backup-uploads.helpers';

const GIB = 1024 * 1024 * 1024;
const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rok2023-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** `/tmp/x/uploads` with feedback + hub-media files; returns the root. */
function seedUploads(): string {
  const root = path.join(tmp, 'uploads');
  fs.mkdirSync(path.join(root, 'feedback'), { recursive: true });
  fs.mkdirSync(path.join(root, 'hub-media', '7'), { recursive: true });
  fs.writeFileSync(path.join(root, 'feedback', '1.png'), 'png-bytes');
  fs.writeFileSync(path.join(root, 'hub-media', '7', `${UUID}.webp`), 'webp');
  return root;
}

function listTar(file: string): string[] {
  return execFileSync('tar', ['-tf', file], { encoding: 'utf8' })
    .split('\n')
    .filter((l) => l.length > 0);
}

const roomy = () => ({ bavail: 1_000_000, bsize: 1024 * 1024 });
const noWarn = () => undefined;

describe('uploadsArchiveName', () => {
  it('swaps .dump for .uploads.tar, keeping the timestamp', () => {
    expect(uploadsArchiveName('raid_ledger_2026-10-27_020010.dump')).toBe(
      'raid_ledger_2026-10-27_020010.uploads.tar',
    );
  });

  it('appends .uploads.tar when the name has no .dump suffix', () => {
    expect(uploadsArchiveName('raid_ledger_x')).toBe(
      'raid_ledger_x.uploads.tar',
    );
  });
});

describe('resolveUploadsDir', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('prefers BACKUP_UPLOADS_DIR', () => {
    process.env.BACKUP_UPLOADS_DIR = '/sandbox/up';
    process.env.NODE_ENV = 'production';
    expect(resolveUploadsDir()).toBe('/sandbox/up');
  });

  it('uses /data/uploads in production', () => {
    delete process.env.BACKUP_UPLOADS_DIR;
    process.env.NODE_ENV = 'production';
    expect(resolveUploadsDir()).toBe('/data/uploads');
  });

  it('uses <cwd>/uploads outside production', () => {
    delete process.env.BACKUP_UPLOADS_DIR;
    process.env.NODE_ENV = 'test';
    expect(resolveUploadsDir()).toBe(path.join(process.cwd(), 'uploads'));
  });
});

describe('tarCreateArgs', () => {
  it('archives the root under its basename from its parent dir', () => {
    expect(
      tarCreateArgs('/b/daily/x.uploads.tar.partial', '/data/uploads'),
    ).toEqual([
      '-cf',
      '/b/daily/x.uploads.tar.partial',
      '-C',
      '/data',
      'uploads',
    ]);
  });
});

describe('isTarFatal', () => {
  const CHANGED = 'tar: uploads/a.png: file changed as we read it\n';
  const exit = (code: number | string, stderr = CHANGED) =>
    Object.assign(new Error('tar'), { code, stderr });

  it('treats exit 1 with a non-empty archive as a warning', () => {
    const out = path.join(tmp, 'a.tar');
    fs.writeFileSync(out, 'x');
    expect(isTarFatal(exit(1), out)).toBe(false);
    const removed = 'tar: uploads/b.png: File removed before we read it\n';
    expect(isTarFatal(exit(1, CHANGED + removed), out)).toBe(false);
  });

  it('treats exit 1 with any non-benign stderr line as fatal (BusyBox)', () => {
    const out = path.join(tmp, 'a.tar');
    fs.writeFileSync(out, 'x');
    const unreadable = "tar: can't open 'uploads/c.png': Permission denied\n";
    expect(isTarFatal(exit(1, unreadable), out)).toBe(true);
    expect(isTarFatal(exit(1, CHANGED + unreadable), out)).toBe(true);
  });

  it('treats a BusyBox vanished member + delayed-exit trailer as a warning (AC9)', () => {
    const out = path.join(tmp, 'a.tar');
    fs.writeFileSync(out, 'x');
    const vanished = 'tar: uploads/f2178: No such file or directory\n';
    const delayed = 'tar: error exit delayed from previous errors\n';
    expect(isTarFatal(exit(1, vanished + delayed), out)).toBe(false);
    expect(isTarFatal(exit(1, delayed), out)).toBe(true);
    const unreadable = "tar: can't open 'uploads/s': Permission denied\n";
    expect(isTarFatal(exit(1, vanished + unreadable + delayed), out)).toBe(
      true,
    );
  });

  it('treats exit 1 with empty stderr as fatal (no proof it was benign)', () => {
    const out = path.join(tmp, 'a.tar');
    fs.writeFileSync(out, 'x');
    expect(isTarFatal(exit(1, ''), out)).toBe(true);
  });

  it('treats exit 1 with a missing archive as fatal', () => {
    expect(isTarFatal(exit(1), path.join(tmp, 'none.tar'))).toBe(true);
  });

  it('treats exit 1 with an empty archive as fatal', () => {
    const out = path.join(tmp, 'empty.tar');
    fs.writeFileSync(out, '');
    expect(isTarFatal(exit(1), out)).toBe(true);
  });

  it('treats exit 2 as fatal even with output present', () => {
    const out = path.join(tmp, 'a.tar');
    fs.writeFileSync(out, 'x');
    expect(isTarFatal(exit(2), out)).toBe(true);
  });

  it('treats a spawn ENOENT as fatal', () => {
    expect(isTarFatal(exit('ENOENT'), path.join(tmp, 'a.tar'))).toBe(true);
  });

  it('treats a non-error value as fatal', () => {
    expect(isTarFatal('boom', path.join(tmp, 'a.tar'))).toBe(true);
  });
});

describe('hasRoomFor', () => {
  const statfs = () => ({ bavail: 10, bsize: 100 }); // 1000 bytes free

  it('is true when bytes + reserve equals free space exactly', () => {
    expect(hasRoomFor(600, tmp, 400, statfs)).toBe(true);
  });

  it('is false one byte past the boundary', () => {
    expect(hasRoomFor(601, tmp, 400, statfs)).toBe(false);
  });

  it('reserves 1 GiB by default', () => {
    expect(UPLOADS_RESERVE_BYTES).toBe(GIB);
  });
});

describe('measureTree', () => {
  it('sums nested regular files', () => {
    const root = seedUploads();
    expect(measureTree(root)).toBe('png-bytes'.length + 'webp'.length);
  });

  it('counts a symlink as 0 bytes, not its target', () => {
    const root = seedUploads();
    const big = path.join(tmp, 'big.bin');
    fs.writeFileSync(big, Buffer.alloc(4096));
    fs.symlinkSync(big, path.join(root, 'link.bin'));
    expect(measureTree(root)).toBe('png-bytes'.length + 'webp'.length);
  });
});

describe('archiveUploads', () => {
  const outFor = () => path.join(tmp, 'daily', 'raid_ledger_ts.uploads.tar');

  beforeEach(() => {
    fs.mkdirSync(path.join(tmp, 'daily'));
  });

  it('writes a tar holding the tree under uploads/', async () => {
    const outPath = outFor();
    const res = await archiveUploads({
      uploadsDir: seedUploads(),
      outPath,
      dailyDir: path.dirname(outPath),
      warn: noWarn,
      statfs: roomy,
    });
    expect(res).toEqual({ status: 'written', path: outPath });
    const members = listTar(outPath).map((m) => m.replace(/\/$/, ''));
    expect(members).toEqual(
      expect.arrayContaining([
        'uploads/feedback/1.png',
        `uploads/hub-media/7/${UUID}.webp`,
      ]),
    );
    expect(fs.existsSync(`${outPath}.partial`)).toBe(false);
  });

  it('skips with a warning when the root is missing', async () => {
    const outPath = outFor();
    const warn = jest.fn();
    const res = await archiveUploads({
      uploadsDir: path.join(tmp, 'nope'),
      outPath,
      dailyDir: path.dirname(outPath),
      warn,
      statfs: roomy,
    });
    expect(res).toEqual({ status: 'skipped', reason: 'missing-root' });
    expect(fs.existsSync(outPath)).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('uploads dir missing'),
    );
  });

  it('still writes an archive for an empty root', async () => {
    const outPath = outFor();
    const root = path.join(tmp, 'uploads');
    fs.mkdirSync(root);
    const res = await archiveUploads({
      uploadsDir: root,
      outPath,
      dailyDir: path.dirname(outPath),
      warn: noWarn,
      statfs: roomy,
    });
    expect(res).toEqual({ status: 'written', path: outPath });
    expect(listTar(outPath).map((m) => m.replace(/\/$/, ''))).toContain(
      'uploads',
    );
  });

  it('fails with insufficient-space and leaves no file or partial', async () => {
    const outPath = outFor();
    const res = await archiveUploads({
      uploadsDir: seedUploads(),
      outPath,
      dailyDir: path.dirname(outPath),
      warn: noWarn,
      statfs: () => ({ bavail: 1, bsize: 1024 }),
    });
    expect(res).toEqual({ status: 'failed', reason: 'insufficient-space' });
    expect(fs.readdirSync(path.dirname(outPath))).toEqual([]);
  });

  it('fails with measure-failed when the tree cannot be walked', async () => {
    const outPath = outFor();
    const runTar = jest.fn();
    const res = await archiveUploads({
      uploadsDir: seedUploads(),
      outPath,
      dailyDir: path.dirname(outPath),
      warn: noWarn,
      statfs: roomy,
      runTar,
      measure: () => {
        throw new Error('EACCES: permission denied');
      },
    });
    expect(res).toEqual({
      status: 'failed',
      reason: 'measure-failed',
      detail: 'EACCES: permission denied',
    });
    expect(runTar).not.toHaveBeenCalled();
    expect(fs.readdirSync(path.dirname(outPath))).toEqual([]);
  });

  it('fails with tar-failed and removes the partial when tar errors', async () => {
    const outPath = outFor();
    const res = await archiveUploads({
      uploadsDir: seedUploads(),
      outPath,
      dailyDir: path.dirname(outPath),
      warn: noWarn,
      statfs: roomy,
      runTar: (args) => {
        const partial = args[1] ?? '';
        fs.writeFileSync(partial, 'half');
        return Promise.reject(Object.assign(new Error('bad'), { code: 2 }));
      },
    });
    expect(res).toMatchObject({ status: 'failed', reason: 'tar-failed' });
    expect(fs.readdirSync(path.dirname(outPath))).toEqual([]);
  });

  it('keeps the archive and warns on a GNU exit-1 with output', async () => {
    const outPath = outFor();
    const warn = jest.fn();
    const res = await archiveUploads({
      uploadsDir: seedUploads(),
      outPath,
      dailyDir: path.dirname(outPath),
      warn,
      statfs: roomy,
      runTar: (args) => {
        fs.writeFileSync(args[1] ?? '', 'changed-as-we-read');
        return Promise.reject(
          Object.assign(new Error('chg'), {
            code: 1,
            stderr: 'tar: uploads/x: file changed as we read it\n',
          }),
        );
      },
    });
    expect(res).toEqual({ status: 'written', path: outPath });
    expect(fs.readFileSync(outPath, 'utf8')).toBe('changed-as-we-read');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('exit 1'));
  });
});
