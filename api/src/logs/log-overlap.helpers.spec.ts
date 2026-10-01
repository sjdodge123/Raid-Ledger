/**
 * An overlapping logrotate generation (an older file that repeats the start of
 * a newer one) is found by comparing the first 4 KB. Real files, no fs mock.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { gzipSync } from 'node:zlib';
import type { ExportFile } from './export-budget.helpers';
import {
  HEAD_BYTES,
  HEAD_READ_CONCURRENCY,
  dropOverlappingGenerations,
  readHead,
} from './log-overlap.helpers';

/** Timestamped log lines `from`..`to` (~80 bytes each). */
function logLines(from: number, to: number): string {
  let out = '';
  for (let i = from; i <= to; i++) {
    const ts = new Date(Date.UTC(2026, 8, 23, 9, 2, i)).toISOString();
    out += `${ts} INFO [Http] GET /api/events/${i} 200 - request handled\n`;
  }
  return out;
}

let tmpDir: string;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-overlap-'));
});
afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

/** Write a fixture; `size` is its uncompressed bytes, like the service's. */
function fixture(filename: string, content: string): ExportFile {
  const filepath = path.join(tmpDir, filename);
  const body = filename.endsWith('.gz') ? gzipSync(content) : content;
  fs.writeFileSync(filepath, body);
  return { filepath, filename, size: Buffer.byteLength(content) };
}

async function droppedNames(files: ExportFile[]) {
  const { kept, duplicates } = await dropOverlappingGenerations(files);
  return {
    kept: kept.map((f) => f.filename),
    dropped: duplicates.map((f) => f.filename),
  };
}

const reason = (newer: string) =>
  `duplicate of ${newer} (overlapping generation: same first 4 KB)`;

describe('dropOverlappingGenerations drops', () => {
  it('drops an older generation that is a byte-prefix of a newer one', async () => {
    expect(Buffer.byteLength(logLines(1, 100))).toBeGreaterThan(HEAD_BYTES);
    const older = fixture('api.log.4.gz', logLines(1, 100));
    const newer = fixture('api.log.3.gz', logLines(1, 200));

    const result = await dropOverlappingGenerations([older, newer]);

    expect(result.kept.map((f) => f.filename)).toEqual(['api.log.3.gz']);
    expect(result.duplicates).toEqual([
      {
        filename: 'api.log.4.gz',
        size: older.size,
        reason: reason('api.log.3.gz'),
      },
    ]);
  });

  it('names a generation that STAYS in the export when several match (a chain)', async () => {
    // .4 is a prefix of .3, and .3 of .2: .3 is dropped too, so .4 must not
    // name it — the manifest would point at a file that is not in the archive.
    const files = [
      fixture('api.log.2.gz', logLines(1, 300)),
      fixture('api.log.3.gz', logLines(1, 200)),
      fixture('api.log.4.gz', logLines(1, 100)),
    ];
    const { kept, duplicates } = await dropOverlappingGenerations(files);
    expect(kept.map((f) => f.filename)).toEqual(['api.log.2.gz']);
    expect(duplicates.map((d) => [d.filename, d.reason])).toEqual([
      ['api.log.3.gz', reason('api.log.2.gz')],
      ['api.log.4.gz', reason('api.log.2.gz')],
    ]);
  });

  it('a .1 that repeats the start of the live file', async () => {
    // The live file can be the newer match (copytruncate plus a restart).
    const files = [
      fixture('api.log', logLines(1, 200)),
      fixture('api.log.1', logLines(1, 100)),
    ];
    const { kept, duplicates } = await dropOverlappingGenerations(files);
    expect(kept.map((f) => f.filename)).toEqual(['api.log']);
    expect(duplicates.map((d) => [d.filename, d.reason])).toEqual([
      ['api.log.1', reason('api.log')],
    ]);
  });
});

describe('dropOverlappingGenerations keeps', () => {
  it('generations whose heads differ', async () => {
    const files = [
      fixture('api.log', logLines(301, 320)),
      fixture('api.log.3.gz', logLines(101, 300)),
      fixture('api.log.4.gz', logLines(1, 100)),
    ];
    expect(await droppedNames(files)).toEqual({
      kept: ['api.log', 'api.log.3.gz', 'api.log.4.gz'],
      dropped: [],
    });
  });

  it('equal-generation twins (api.log.1 and api.log.1.gz)', async () => {
    const files = [
      fixture('api.log.1', logLines(1, 100)),
      fixture('api.log.1.gz', logLines(1, 100)),
    ];
    expect((await droppedNames(files)).dropped).toEqual([]);
  });

  it('an older generation that is LARGER than the newer one', async () => {
    const files = [
      fixture('api.log.3.gz', logLines(1, 100)),
      fixture('api.log.4.gz', logLines(1, 200)),
    ];
    expect((await droppedNames(files)).dropped).toEqual([]);
  });

  it('generations of different logs, even when identical', async () => {
    // Each log has a sibling, so both of the identical files are read.
    const files = [
      fixture('nginx-access.log', 'nginx live\n'),
      fixture('nginx-access.log.1', logLines(1, 100)),
      fixture('api.log', 'api live\n'),
      fixture('api.log.2.gz', logLines(1, 100)),
    ];
    expect((await droppedNames(files)).dropped).toEqual([]);
  });

  it('empty generations', async () => {
    const files = [
      fixture('api.log', ''),
      fixture('api.log.1', ''),
      fixture('api.log.2.gz', ''),
    ];
    expect((await droppedNames(files)).dropped).toEqual([]);
  });
});

describe('readHead', () => {
  it('returns only the first HEAD_BYTES of a large gzip', async () => {
    const filepath = path.join(tmpDir, 'api.log.2.gz');
    fs.writeFileSync(filepath, gzipSync(Buffer.alloc(5 * 1024 * 1024, 'a')));
    const head = await readHead(filepath);
    expect(head?.length).toBe(HEAD_BYTES);
  });

  it('returns the whole content of a short file', async () => {
    const { filepath } = fixture('api.log.1', 'hello\n');
    expect((await readHead(filepath))?.toString()).toBe('hello\n');
  });

  it('returns null for a corrupt or missing .gz', async () => {
    const corrupt = path.join(tmpDir, 'api.log.2.gz');
    fs.writeFileSync(corrupt, 'not a gzip stream at all');
    expect(await readHead(corrupt)).toBeNull();
    expect(await readHead(path.join(tmpDir, 'api.log.9.gz'))).toBeNull();
  });
});

describe('dropOverlappingGenerations reading heads', () => {
  const realFs = jest.requireActual<typeof fs>('node:fs');
  afterEach(() => jest.restoreAllMocks());

  it('keeps at most HEAD_READ_CONCURRENCY files open at once', async () => {
    const files = Array.from({ length: 3 * HEAD_READ_CONCURRENCY }, (_, i) =>
      fixture(`api.log.${i + 2}.gz`, logLines(i * 10 + 1, i * 10 + 10)),
    );
    let open = 0;
    let maxOpen = 0;
    const create = realFs.createReadStream.bind(realFs);
    jest.spyOn(realFs, 'createReadStream').mockImplementation((...args) => {
      const stream = create(...args);
      maxOpen = Math.max(maxOpen, ++open);
      const destroy = stream.destroy.bind(stream);
      stream.destroy = (err?: Error) => {
        if (!stream.destroyed) open--;
        return destroy(err);
      };
      return stream;
    });

    await dropOverlappingGenerations(files);

    expect(realFs.createReadStream).toHaveBeenCalledTimes(files.length);
    expect(maxOpen).toBeLessThanOrEqual(HEAD_READ_CONCURRENCY);
  });
});
