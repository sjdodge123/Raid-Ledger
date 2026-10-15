import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { FEEDBACK_SCREENSHOT_MAX_BASE64_CHARS } from '@raid-ledger/contract';
import {
  deleteScreenshotFiles,
  getFeedbackScreenshotDir,
  resolveScreenshotPath,
  sniffImageType,
  validateScreenshot,
  writeScreenshot,
} from './feedback-screenshot.helpers';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const GIF = Buffer.from('GIF89a-not-allowed');
const b64 = (buf: Buffer): string => buf.toString('base64');

describe('sniffImageType', () => {
  it('identifies PNG and JPEG by magic bytes', () => {
    expect(sniffImageType(PNG)).toBe('png');
    expect(sniffImageType(JPEG)).toBe('jpg');
  });

  it('rejects GIF, text and truncated headers', () => {
    expect(sniffImageType(GIF)).toBeNull();
    expect(sniffImageType(Buffer.from('hello world'))).toBeNull();
    expect(sniffImageType(PNG.subarray(0, 4))).toBeNull();
  });
});

describe('validateScreenshot', () => {
  it('returns the decoded bytes and extension for a PNG', () => {
    const result = validateScreenshot(b64(PNG));
    expect(result.ext).toBe('png');
    expect(result.buf.equals(PNG)).toBe(true);
  });

  it('accepts a JPEG behind a stray data-URL header', () => {
    expect(validateScreenshot(`data:image/jpeg;base64,${b64(JPEG)}`).ext).toBe(
      'jpg',
    );
  });

  it('ignores the declared MIME: data:image/png over text is a 400', () => {
    const forged = `data:image/png;base64,${b64(Buffer.from('not an image'))}`;
    expect(() => validateScreenshot(forged)).toThrow(BadRequestException);
  });

  it('rejects a GIF with 400', () => {
    expect(() => validateScreenshot(b64(GIF))).toThrow(
      'Screenshot must be a PNG or JPEG image',
    );
  });

  it('throws 413 one character over the encoded cap', () => {
    const tooLong = 'A'.repeat(FEEDBACK_SCREENSHOT_MAX_BASE64_CHARS + 1);
    expect(() => validateScreenshot(tooLong)).toThrow(PayloadTooLargeException);
  });
});

describe('screenshot storage', () => {
  const original = process.env.RAID_LEDGER_FEEDBACK_DIR;
  let dir = '';

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'rl-feedback-'));
    process.env.RAID_LEDGER_FEEDBACK_DIR = path.join(dir, 'feedback');
  });

  afterEach(async () => {
    if (original === undefined) delete process.env.RAID_LEDGER_FEEDBACK_DIR;
    else process.env.RAID_LEDGER_FEEDBACK_DIR = original;
    await rm(dir, { recursive: true, force: true });
  });

  it('writes <id>.<ext> into a lazily created dir and deletes it', async () => {
    const rel = await writeScreenshot(42, PNG, 'png');
    expect(rel).toBe('feedback/42.png');
    const abs = path.join(getFeedbackScreenshotDir(), '42.png');
    expect((await readFile(abs)).equals(PNG)).toBe(true);

    expect(await deleteScreenshotFiles([rel])).toEqual([]);
    await expect(stat(abs)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('replaces a stale file left by a reused id (DB reset/restore)', async () => {
    const stale = path.join(getFeedbackScreenshotDir(), '7.png');
    await writeScreenshot(7, JPEG, 'jpg');
    await writeFile(stale, Buffer.from('stale-orphan-from-old-db'));

    await expect(writeScreenshot(7, PNG, 'png')).resolves.toBe(
      'feedback/7.png',
    );
    expect((await readFile(stale)).toString('hex')).toBe(PNG.toString('hex'));
    const sibling = path.join(getFeedbackScreenshotDir(), '7.jpg');
    await expect(stat(sibling)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('treats an already-deleted file as success', async () => {
    expect(await deleteScreenshotFiles(['feedback/999.png'])).toEqual([]);
  });

  it('refuses paths that escape the screenshot dir', async () => {
    const evil = [
      'feedback/../secret.png',
      '../etc/passwd',
      'feedback/a/b.png',
    ];
    const outside = path.join(dir, 'secret.png');
    await writeFile(outside, PNG);
    for (const p of evil) expect(resolveScreenshotPath(p)).toBeNull();
    expect(await deleteScreenshotFiles(evil)).toEqual(evil);
    expect((await stat(outside)).isFile()).toBe(true);
  });
});
