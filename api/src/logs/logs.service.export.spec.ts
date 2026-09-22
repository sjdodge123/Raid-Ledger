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
    const name = header.subarray(0, 100).toString('utf-8').replace(/\0.*$/s, '');
    const size = parseInt(header.subarray(124, 136).toString('utf-8'), 8);
    const body = tar.subarray(offset + 512, offset + 512 + size);
    entries.push([name, body.toString('utf-8')]);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function describeExport() {
  let service: LogsService;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logs-export-'));
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LogsService,
        {
          provide: ConfigService,
          useValue: { get: (key: string) => (key === 'LOG_DIR' ? tmpDir : undefined) },
        },
      ],
    }).compile();
    service = module.get(LogsService);
  });

  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('decompresses, scrubs and stores a .gz generation as plain text', async () => {
    fs.writeFileSync(path.join(tmpDir, 'api.log.2.gz'), gzipSync(SECRET_LINE));
    fs.writeFileSync(path.join(tmpDir, 'api.log'), SECRET_LINE);

    const tar = gunzipSync(
      await collect(service.createExportStream(['api.log.2.gz', 'api.log'])),
    );

    expect(untar(tar)).toEqual([
      ['api.log.2', SCRUBBED_LINE],
      ['api.log', SCRUBBED_LINE],
    ]);
  });

  it('rejects a .gz whose declared uncompressed size exceeds the cap', () => {
    const gz = gzipSync(SECRET_LINE);
    gz.writeUInt32LE(0xffffffff, gz.length - 4); // gzip ISIZE trailer
    fs.writeFileSync(path.join(tmpDir, 'api.log.3.gz'), gz);

    expect(() => service.createExportStream(['api.log.3.gz'])).toThrow(
      'exceeds maximum of 100 MB',
    );
  });

  it('streams a .gz generation as scrubbed text for single-file download', async () => {
    const filepath = path.join(tmpDir, 'redis.log.4.gz');
    fs.writeFileSync(filepath, gzipSync(SECRET_LINE));

    const text = (await collect(service.createScrubbedStream(filepath))).toString();

    expect(text).toBe(SCRUBBED_LINE);
  });
}
describe('LogsService export of rotated .gz generations (ROK-1164)', () =>
  describeExport());
