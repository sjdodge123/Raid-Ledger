/**
 * ROK-1164 — the export must not corrupt logrotate's `.log.N.gz` generations.
 * Real filesystem (no fs mock): a gzipped generation is decompressed, scrubbed
 * and stored as plain text under its name minus `.gz`.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { Readable } from 'node:stream';
import { LogsService } from './logs.service';

const SECRET_LINE = 'boot DATABASE_URL=postgresql://u:p@h/db\nhello\n';
const SCRUBBED_LINE = 'boot DATABASE_URL=[REDACTED]\nhello\n';
/**
 * SECRET_LINE behind a distinct first line. Generations with identical
 * content are an overlapping rotation and are left out as duplicates, so
 * fixtures that model separate generations must differ from the start.
 */
const secretGen = (gen: string) => `gen-${gen}\n${SECRET_LINE}`;
const scrubbedGen = (gen: string) => `gen-${gen}\n${SCRUBBED_LINE}`;

/** `n` timestamped log lines (~80 bytes each), the same for every caller. */
function logLines(n: number): string {
  let out = '';
  for (let i = 1; i <= n; i++) {
    const ts = new Date(Date.UTC(2026, 8, 23, 9, 2, i)).toISOString();
    out += `${ts} INFO [Http] GET /api/events/${i} 200 - request handled\n`;
  }
  return out;
}

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** Parse an uncompressed POSIX tar into [name, text] pairs. */
function untar(tar: Buffer): [string, string][] {
  const entries: [string, string][] = [];
  let offset = 0;
  while (offset + 512 <= tar.length && tar[offset] !== 0) {
    const header = tar.subarray(offset, offset + 512);
    const name = header
      .subarray(0, 100)
      .toString('utf-8')
      .replace(/\0.*$/s, '');
    const size = parseInt(header.subarray(124, 136).toString('utf-8'), 8);
    const body = tar.subarray(offset + 512, offset + 512 + size);
    entries.push([name, body.toString('utf-8')]);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function useExportService() {
  const ctx = {} as { service: LogsService; tmpDir: string };
  beforeEach(async () => {
    ctx.tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logs-export-'));
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LogsService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => (key === 'LOG_DIR' ? ctx.tmpDir : undefined),
          },
        },
      ],
    }).compile();
    ctx.service = module.get(LogsService);
  });
  afterEach(() => fs.rmSync(ctx.tmpDir, { recursive: true, force: true }));
  return ctx;
}

function describeGzExport() {
  const ctx = useExportService();

  it('decompresses, scrubs and stores a .gz generation as plain text', async () => {
    fs.writeFileSync(
      path.join(ctx.tmpDir, 'api.log.2.gz'),
      gzipSync(secretGen('2')),
    );
    fs.writeFileSync(path.join(ctx.tmpDir, 'api.log'), secretGen('0'));

    const tar = gunzipSync(
      await collect(
        await ctx.service.createExportStream(['api.log.2.gz', 'api.log']),
      ),
    );

    const entries = untar(tar);
    expect(entries.slice(0, 2)).toEqual([
      // live files first, then history newest-first
      ['api.log', scrubbedGen('0')],
      ['api.log.2.decompressed', scrubbedGen('2')],
    ]);
    // the manifest documents the .decompressed naming
    expect(entries[2][0]).toBe('MANIFEST.txt');
    expect(entries[2][1]).toContain('.decompressed');
  });

  it('skips a history .gz whose declared size is over the cap instead of 413ing', async () => {
    // Was asserting a 413 here — wrong: rotated history must never 413 the
    // export. An oversized history file is left out and listed in the manifest.
    const gz = gzipSync(SECRET_LINE);
    gz.writeUInt32LE(0xffffffff, gz.length - 4); // gzip ISIZE trailer
    fs.writeFileSync(path.join(ctx.tmpDir, 'api.log.3.gz'), gz);

    const entries = untar(
      gunzipSync(
        await collect(await ctx.service.createExportStream(['api.log.3.gz'])),
      ),
    );

    expect(entries.map(([name]) => name)).toEqual(['MANIFEST.txt']);
    expect(entries[0][1]).toContain(
      `api.log.3.gz\t${0xffffffff} bytes\tskipped: over cap`,
    );
  });

  it('still 413s when a live file declares a size over the cap', async () => {
    const gz = gzipSync(SECRET_LINE);
    gz.writeUInt32LE(0xffffffff, gz.length - 4);
    fs.writeFileSync(path.join(ctx.tmpDir, 'api.log.1.gz'), gz);

    await expect(
      ctx.service.createExportStream(['api.log.1.gz']),
    ).rejects.toThrow('exceeds maximum of 100 MB');
  });

  it('streams a .gz generation as scrubbed text for single-file download', async () => {
    const filepath = path.join(ctx.tmpDir, 'redis.log.4.gz');
    fs.writeFileSync(filepath, gzipSync(SECRET_LINE));

    const text = (
      await collect(ctx.service.createScrubbedStream(filepath))
    ).toString();

    expect(text).toBe(SCRUBBED_LINE);
  });
}

function describeHistoryCap() {
  const ctx = useExportService();

  it('export-all keeps live + .1, adds older generations newest-first under the cap, and lists the rest in MANIFEST.txt', async () => {
    const write = (name: string, body: Buffer | string) =>
      fs.writeFileSync(path.join(ctx.tmpDir, name), body);
    write('api.log', secretGen('0'));
    write('api.log.1', secretGen('1'));
    write('api.log.2.gz', gzipSync(secretGen('2')));
    const big = gzipSync(secretGen('3')); // claims just under the cap on its own
    big.writeUInt32LE(100 * 1024 * 1024 - 10, big.length - 4);
    write('api.log.3.gz', big);
    write('api.log.4.gz', gzipSync(secretGen('4')));
    const bigSize = 100 * 1024 * 1024 - 10;
    const smallSize = Buffer.byteLength(secretGen('4'));

    const tar = gunzipSync(
      await collect(
        await ctx.service.createExportStream([
          'api.log.4.gz',
          'api.log.3.gz',
          'api.log',
          'api.log.2.gz',
          'api.log.1',
        ]),
      ),
    );

    const entries = untar(tar);
    expect(entries.map(([name]) => name)).toEqual([
      'api.log',
      'api.log.1',
      'api.log.2.decompressed',
      'MANIFEST.txt',
    ]);
    const manifest = entries[3][1];
    expect(manifest).toContain(
      `api.log.3.gz\t${bigSize} bytes\tskipped: over cap`,
    );
    expect(manifest).toContain(
      `api.log.4.gz\t${smallSize} bytes\tskipped: over cap`,
    );
  });

  it('adds no MANIFEST.txt when nothing is skipped', async () => {
    fs.writeFileSync(path.join(ctx.tmpDir, 'api.log'), SECRET_LINE);
    const tar = gunzipSync(
      await collect(await ctx.service.createExportStream(['api.log'])),
    );
    expect(untar(tar).map(([name]) => name)).toEqual(['api.log']);
  });
}

/** An overlapping rotation (copytruncate plus a restart) is exported once. */
function describeOverlap() {
  const ctx = useExportService();

  it('leaves out an older generation that repeats the start of a newer one (overlapping rotation)', async () => {
    const write = (name: string, body: Buffer | string) =>
      fs.writeFileSync(path.join(ctx.tmpDir, name), body);
    const older = logLines(100); // a byte-prefix of the newer generation
    write('api.log', 'gen-0 live line\n');
    write('api.log.3.gz', gzipSync(logLines(200)));
    write('api.log.4.gz', gzipSync(older));

    const tar = gunzipSync(
      await collect(
        await ctx.service.createExportStream([
          'api.log',
          'api.log.3.gz',
          'api.log.4.gz',
        ]),
      ),
    );

    const entries = untar(tar);
    expect(entries.map(([name]) => name)).toEqual([
      'api.log',
      'api.log.3.decompressed',
      'MANIFEST.txt',
    ]);
    const lines = entries
      .filter(([name]) => name !== 'MANIFEST.txt')
      .flatMap(([, text]) => text.split('\n'))
      .filter((line) => line !== '');
    expect(lines.filter((line, i) => lines.indexOf(line) !== i)).toEqual([]);
    expect(entries[2][1]).toContain(
      `api.log.4.gz\t${Buffer.byteLength(older)} bytes\tskipped: duplicate of api.log.3.gz`,
    );
  });
}

/** Overlap detection runs BEFORE the cap, the live tier's 413 included. */
function describeOverlapVsCap() {
  const ctx = useExportService();
  const write = (name: string, body: Buffer | string) =>
    fs.writeFileSync(path.join(ctx.tmpDir, name), body);
  /** A gzip of SECRET_LINE whose ISIZE trailer claims `bytes`. */
  const claimsSize = (bytes: number) => {
    const gz = gzipSync(SECRET_LINE);
    gz.writeUInt32LE(bytes, gz.length - 4);
    return gz;
  };

  it('a .1 that repeats the live file never counts against the cap (no 413)', async () => {
    // 101 MB together, over the cap; the live file alone fits.
    write('api.log', Buffer.alloc(51 * MB, 'a'));
    write('api.log.1', Buffer.alloc(50 * MB, 'a'));

    const result = await exportEntries(ctx.service, ['api.log', 'api.log.1']);

    expect(result.error).toBeUndefined();
    expect(result.entries?.map(([name]) => name)).toEqual([
      'api.log',
      'MANIFEST.txt',
    ]);
    expect(result.entries?.[1][1]).toContain(
      `api.log.1\t${50 * MB} bytes\tskipped: duplicate of api.log`,
    );
  }, 30_000);

  it('live files that are not duplicates still 413 together, before any byte', async () => {
    write('api.log.1.gz', claimsSize(60 * MB));
    write('redis.log.1.gz', claimsSize(60 * MB));

    await expect(
      ctx.service.createExportStream(['api.log.1.gz', 'redis.log.1.gz']),
    ).rejects.toThrow('exceeds maximum of 100 MB');
  });
}

/** Resolve the export to its tar entries, or to the error that cut it short. */
async function exportEntries(service: LogsService, names: string[]) {
  try {
    const gz = await collect(await service.createExportStream(names));
    return { entries: untar(gunzipSync(gz)) };
  } catch (err) {
    return { error: String(err) };
  }
}

/** A gzip that inflates to `bytes` of log lines but whose ISIZE claims 10. */
function forgedGzip(bytes: number): Buffer {
  const line = 'x'.repeat(1023) + '\n';
  const gz = gzipSync(Buffer.from(line.repeat(Math.ceil(bytes / 1024))));
  gz.writeUInt32LE(10, gz.length - 4);
  return gz;
}

const MB = 1024 * 1024;

function describeRealBytes() {
  const ctx = useExportService();
  const write = (name: string, body: Buffer | string) =>
    fs.writeFileSync(path.join(ctx.tmpDir, name), body);

  it('a .gz that lies about its size is left out cleanly, never a truncated archive', async () => {
    write('api.log', SECRET_LINE);
    write('api.log.2.gz', forgedGzip(101 * MB));

    const result = await exportEntries(ctx.service, [
      'api.log',
      'api.log.2.gz',
    ]);

    expect(result.error).toBeUndefined();
    expect(result.entries?.map(([name]) => name)).toEqual([
      'api.log',
      'MANIFEST.txt',
    ]);
    expect(result.entries?.[1][1]).toMatch(
      /api\.log\.2\.gz\t.*skipped: over cap/,
    );
  });

  it('counts real decompressed bytes against the REMAINING budget', async () => {
    write('api.log', Buffer.alloc(60 * MB, 'a'));
    write('api.log.2.gz', forgedGzip(50 * MB)); // declares 10 bytes

    const result = await exportEntries(ctx.service, [
      'api.log',
      'api.log.2.gz',
    ]);

    expect(result.entries?.map(([name]) => name)).toEqual([
      'api.log',
      'MANIFEST.txt',
    ]);
  }, 30_000);

  it('never stores two entries under one name, nor a .gz under a live name', async () => {
    for (const name of ['api.log', 'api.log.1', 'api.log.1.gz', 'api.log.gz'])
      write(
        name,
        name.endsWith('.gz') ? gzipSync(secretGen(name)) : secretGen(name),
      );

    const result = await exportEntries(ctx.service, [
      'api.log',
      'api.log.1',
      'api.log.1.gz',
      'api.log.gz',
    ]);

    expect(result.entries?.map(([name]) => name)).toEqual([
      'api.log',
      'api.log.1',
      'api.log.1.decompressed',
      'api.log.decompressed',
      'MANIFEST.txt',
    ]);
    expect(result.entries?.[4][1]).toContain('.decompressed');
  });
}

describe('LogsService export of rotated .gz generations (ROK-1164)', () =>
  describeGzExport());
describe('LogsService export-all under the size cap (ROK-1164)', () =>
  describeHistoryCap());
describe('LogsService export counts real bytes (ROK-1164)', () =>
  describeRealBytes());
describe('LogsService export leaves out overlapping generations', () =>
  describeOverlap());
describe('LogsService export drops duplicates before the size cap', () =>
  describeOverlapVsCap());
