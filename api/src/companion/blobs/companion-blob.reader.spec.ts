/**
 * ROK-1956 Codex P2 — a client that disconnects before or while the reader
 * starts (during the service's async preflight, or while the temp file is
 * opening) must reject the read and leave no temp file behind, instead of
 * leaving `pump()` pending forever with the cleanup unreachable.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { BoundedBodyStream } from '../../common/bounded-body/bounded-body.reader';
import { readCompanionBlobToFile } from './companion-blob.reader';

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rl-companion-reader-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function body(): BoundedBodyStream & PassThrough {
  return Object.assign(new PassThrough(), {
    headers: { 'content-type': 'image/webp' },
  });
}

/** The read's outcome, or `pending` if it has not settled within 2 s. */
async function settle(p: Promise<unknown>): Promise<string> {
  let timer: NodeJS.Timeout | undefined;
  const pending = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve('pending'), 2000);
  });
  const outcome = p.then(
    () => 'resolved',
    (err: unknown) => `rejected: ${(err as Error).message}`,
  );
  try {
    return await Promise.race([outcome, pending]);
  } finally {
    clearTimeout(timer);
  }
}

describe('readCompanionBlobToFile — client aborts (Codex P2)', () => {
  it('a request already destroyed during preflight is refused; no temp file is created', async () => {
    const src = body();
    src.destroy();
    const tmp = join(dir, '.upload-0000000000000000.tmp');
    await expect(settle(readCompanionBlobToFile(src, 1024, tmp))).resolves.toBe(
      'rejected: Blob upload was aborted',
    );
    expect(existsSync(tmp)).toBe(false);
  });

  it('a disconnect while the temp file is opening rejects and unlinks the temp', async () => {
    const src = body();
    const tmp = join(dir, '.upload-1111111111111111.tmp');
    const read = readCompanionBlobToFile(src, 1024, tmp);
    src.destroy(); // before `open` resolves: no data/end listener exists yet
    await expect(settle(read)).resolves.toBe(
      'rejected: Blob upload was aborted',
    );
    expect(readdirSync(dir)).toEqual([]);
  });

  it('a disconnect mid-body rejects and unlinks the temp', async () => {
    const src = body();
    const tmp = join(dir, '.upload-2222222222222222.tmp');
    const read = readCompanionBlobToFile(src, 1024, tmp);
    src.write(Buffer.from('RIFF'));
    setImmediate(() => src.destroy());
    await expect(settle(read)).resolves.toBe(
      'rejected: Blob upload was aborted',
    );
    expect(readdirSync(dir)).toEqual([]);
  });
});
