import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LogsService } from './logs.service';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { gzipSync } from 'node:zlib';

function describeCreateScrubbedStream() {
  let service: LogsService;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logs-test-'));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LogsService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'LOG_DIR') return tmpDir;
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<LogsService>(LogsService);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should not exceed max listeners on large files', async () => {
    const lineCount = 500;
    const lines = Array.from(
      { length: lineCount },
      (_, i) => `[INFO] Log entry ${i} - normal log content`,
    );
    const filepath = path.join(tmpDir, 'test.log');
    fs.writeFileSync(filepath, lines.join('\n') + '\n');

    const stream = service.createScrubbedStream(filepath);
    const warningsSpy = jest.fn();
    process.on('warning', warningsSpy);

    const output = await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString()));
      stream.on('error', reject);
    });

    process.removeListener('warning', warningsSpy);

    const maxListenersWarnings = warningsSpy.mock.calls.filter(
      (args) =>
        args[0] instanceof Error &&
        args[0].message.includes('MaxListenersExceeded'),
    );
    expect(maxListenersWarnings).toHaveLength(0);

    const outputLines = output.trim().split('\n');
    expect(outputLines).toHaveLength(lineCount);
  });

  it('should scrub sensitive content in streamed output', async () => {
    const filepath = path.join(tmpDir, 'sensitive.log');
    const content =
      [
        'Starting server',
        'DATABASE_URL=postgresql://user:pass@host/db',
        'JWT_SECRET=super-secret loaded',
        'Normal log line',
      ].join('\n') + '\n';
    fs.writeFileSync(filepath, content);

    const stream = service.createScrubbedStream(filepath);

    const output = await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString()));
      stream.on('error', reject);
    });

    expect(output).toContain('Starting server');
    expect(output).toContain('DATABASE_URL=[REDACTED]');
    expect(output).toContain('JWT_SECRET=[REDACTED]');
    expect(output).not.toContain('postgresql://user:pass@host/db');
    expect(output).not.toContain('super-secret');
  });

  it('should not accumulate drain listeners on the transform', async () => {
    const lineCount = 200;
    const lines = Array.from(
      { length: lineCount },
      (_, i) => `[INFO] Entry ${i}`,
    );
    const filepath = path.join(tmpDir, 'drain-test.log');
    fs.writeFileSync(filepath, lines.join('\n') + '\n');

    const stream = service.createScrubbedStream(filepath);
    const maxObserved = { drain: 0 };

    const checkInterval = setInterval(() => {
      const count = EventEmitter.listenerCount(stream, 'drain');
      if (count > maxObserved.drain) maxObserved.drain = count;
    }, 1);

    await new Promise<void>((resolve, reject) => {
      stream.on('data', () => {});
      stream.on('end', resolve);
      stream.on('error', reject);
    });

    clearInterval(checkInterval);

    expect(maxObserved.drain).toBeLessThanOrEqual(
      EventEmitter.defaultMaxListeners,
    );
  });
}
describe('LogsService createScrubbedStream', () =>
  describeCreateScrubbedStream());

describe('LogsService createScrubbedStream size cap (ROK-1164)', () => {
  let tmpDir: string;
  let service: LogsService;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logs-cap-'));
    service = new LogsService({
      get: (key: string) => (key === 'LOG_DIR' ? tmpDir : undefined),
    } as never);
  });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('stops a small .gz that inflates past 100 MB, with a truncation marker', async () => {
    const MB = 1024 * 1024;
    const line = 'y'.repeat(1023) + '\n';
    const filepath = path.join(tmpDir, 'api.log.5.gz');
    fs.writeFileSync(filepath, gzipSync(Buffer.from(line.repeat(110 * 1024))));

    let bytes = 0;
    let last = '';
    for await (const chunk of service.createScrubbedStream(filepath)) {
      bytes += (chunk as Buffer).length;
      last = (chunk as Buffer).toString();
    }

    expect({ overCap: bytes > 100 * MB + 200, last: last.slice(-60) }).toEqual({
      overCap: false,
      last: expect.stringContaining('truncated'),
    });
  }, 30_000);
});
