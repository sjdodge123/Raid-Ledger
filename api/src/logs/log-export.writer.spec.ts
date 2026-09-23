/**
 * ROK-1164 — the export writer must respect backpressure: with a consumer
 * that is not reading, it stalls instead of buffering the whole archive.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Writable } from 'node:stream';
import { writeTarArchive } from './log-export.writer';

const nextTick = () => new Promise((resolve) => setImmediate(resolve));

describe('writeTarArchive backpressure (ROK-1164)', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logs-writer-'));
  });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('waits for drain instead of buffering the archive in memory', async () => {
    const filepath = path.join(tmpDir, 'api.log');
    const size = 1024 * 1024;
    fs.writeFileSync(filepath, Buffer.alloc(size, 'a'));
    const held: (() => void)[] = [];
    let written = 0;
    const out = new Writable({
      highWaterMark: 1024,
      write(chunk: Buffer, _enc, done) {
        written += chunk.length;
        held.push(done); // consumer is stalled until released
      },
    });

    const finished = writeTarArchive(
      out,
      [{ filepath, filename: 'api.log', size }],
      { budget: 10 * size, scrub: (text) => text, skipped: [] },
    );
    for (let i = 0; i < 1000 && out.writableLength === 0; i++) await nextTick();
    for (let i = 0; i < 20; i++) await nextTick();

    expect({ buffered: out.writableLength <= 512 + 64 * 1024 }).toEqual({
      buffered: true,
    });

    out._write = (chunk: Buffer, _enc, done) => {
      written += chunk.length;
      done();
    };
    held.splice(0).forEach((done) => done());
    await finished;
    expect(written).toBe(512 + size + 1024); // header + body + end blocks
  });
});
