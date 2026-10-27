/**
 * ROK-1956 (U-8) — WebP RIFF header checks, cross-checked against the
 * synthetic contract fixture and sharp-generated lossy/lossless/alpha files.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { COMPANION_IMAGE_EDGE_MAX } from '@raid-ledger/contract';
import {
  WEBP_HEADER_BYTES,
  parseWebpHeader,
  riffLengthMatches,
  webpSignatureSoFarOk,
  type WebpHeaderResult,
} from './companion-webp.helpers';

const FIXTURE = join(
  __dirname,
  '../../../../packages/contract/companion/bg3-save/v1/fixtures/placeholder-thumbnail.webp',
);

const EDGE = COMPANION_IMAGE_EDGE_MAX;

async function sample(
  opts: sharp.WebpOptions,
  alpha: boolean,
): Promise<Buffer> {
  const background = alpha
    ? { r: 10, g: 20, b: 30, alpha: 0.5 }
    : { r: 10, g: 20, b: 30 };
  const create = {
    width: 300,
    height: 200,
    channels: alpha ? 4 : 3,
    background,
  } as const;
  return sharp({ create }).webp(opts).toBuffer();
}

function reasonOf(r: WebpHeaderResult): string {
  return r.ok ? 'ok' : r.reason;
}

/** A mutable copy of the first header bytes. */
const head = (buf: Buffer): Buffer =>
  Buffer.from(buf.subarray(0, WEBP_HEADER_BYTES));

describe('parseWebpHeader — real files (ROK-1956 U-8)', () => {
  it('reads VP8 (lossy) dims from the placeholder fixture and its RIFF size', () => {
    const file = readFileSync(FIXTURE);
    expect(parseWebpHeader(head(file), EDGE)).toEqual({
      ok: true,
      format: 'VP8 ',
      width: 1280,
      height: 720,
      riffSize: file.length - 8,
    });
    expect(riffLengthMatches(file.length - 8, file.length)).toBe(true);
  });

  it('reads VP8L (lossless) and VP8X (lossy + alpha) dims from sharp output', async () => {
    const lossless = await sample({ lossless: true }, true);
    const alpha = await sample({ quality: 50 }, true);
    const opaque = await sample({ quality: 50 }, false);
    expect(parseWebpHeader(head(lossless), EDGE)).toMatchObject({
      ok: true,
      format: 'VP8L',
      width: 300,
      height: 200,
    });
    expect(parseWebpHeader(head(alpha), EDGE)).toMatchObject({
      ok: true,
      format: 'VP8X',
      width: 300,
      height: 200,
    });
    expect(parseWebpHeader(head(opaque), EDGE)).toMatchObject({
      ok: true,
      format: 'VP8 ',
      width: 300,
      height: 200,
    });
  });
});

describe('parseWebpHeader — refusals (ROK-1956 U-8)', () => {
  it('refuses an animated VP8X', async () => {
    const h = head(await sample({ quality: 50 }, true));
    h[20] = (h[20] ?? 0) | 0x02;
    expect(reasonOf(parseWebpHeader(h, EDGE))).toBe('animated');
  });

  it('refuses a missing RIFF or WEBP magic, and an unknown chunk FourCC', () => {
    const file = readFileSync(FIXTURE);
    const noRiff = head(file);
    noRiff.write('RIFX', 0, 'latin1');
    const noWebp = head(file);
    noWebp.write('WAVE', 8, 'latin1');
    const other = head(file);
    other.write('ALPH', 12, 'latin1');
    expect(reasonOf(parseWebpHeader(noRiff, EDGE))).toBe('not_riff_webp');
    expect(reasonOf(parseWebpHeader(noWebp, EDGE))).toBe('not_riff_webp');
    expect(reasonOf(parseWebpHeader(other, EDGE))).toBe('unknown_chunk');
  });

  it('refuses a bad VP8 start code and a bad VP8L signature / version', async () => {
    const vp8 = head(readFileSync(FIXTURE));
    vp8[24] = 0x00;
    const vp8l = head(await sample({ lossless: true }, true));
    vp8l[20] = 0x2e;
    const vp8lVersion = head(await sample({ lossless: true }, true));
    vp8lVersion[24] = (vp8lVersion[24] ?? 0) | 0x20;
    expect(reasonOf(parseWebpHeader(vp8, EDGE))).toBe('bad_vp8_start_code');
    expect(reasonOf(parseWebpHeader(vp8l, EDGE))).toBe('bad_vp8l_signature');
    expect(reasonOf(parseWebpHeader(vp8lVersion, EDGE))).toBe(
      'bad_vp8l_signature',
    );
  });

  it('accepts an edge of exactly 4096 and refuses 4097 (VP8X 24-bit fields)', async () => {
    const h = head(await sample({ quality: 50 }, true));
    h.writeUIntLE(EDGE - 1, 24, 3);
    expect(parseWebpHeader(h, EDGE)).toMatchObject({
      ok: true,
      width: EDGE,
      height: 200,
    });
    h.writeUIntLE(EDGE, 27, 3);
    expect(reasonOf(parseWebpHeader(h, EDGE))).toBe('edge_out_of_range');
  });

  it('refuses a VP8 frame whose 14-bit width is 0', () => {
    const h = head(readFileSync(FIXTURE));
    h.writeUInt16LE(0, 26);
    expect(reasonOf(parseWebpHeader(h, EDGE))).toBe('edge_out_of_range');
  });

  it('refuses a header shorter than 30 bytes', () => {
    const h = head(readFileSync(FIXTURE)).subarray(0, WEBP_HEADER_BYTES - 1);
    expect(reasonOf(parseWebpHeader(h, EDGE))).toBe('truncated');
  });
});

describe('webpSignatureSoFarOk + riffLengthMatches', () => {
  it('judges the RIFF/WEBP magic on a partial prefix', () => {
    const file = readFileSync(FIXTURE);
    expect(webpSignatureSoFarOk(file.subarray(0, 2))).toBe(true);
    expect(webpSignatureSoFarOk(file.subarray(0, 10))).toBe(true);
    expect(webpSignatureSoFarOk(Buffer.from([0x89, 0x50]))).toBe(false);
    expect(webpSignatureSoFarOk(Buffer.from('RIFF\0\0\0\0WA', 'latin1'))).toBe(
      false,
    );
  });

  it('catches a RIFF length mismatch at EOF', () => {
    const file = readFileSync(FIXTURE);
    const riff = file.readUInt32LE(4);
    expect(riffLengthMatches(riff, file.length)).toBe(true);
    expect(riffLengthMatches(riff, file.length + 1)).toBe(false);
    expect(riffLengthMatches(riff, file.length - 1)).toBe(false);
  });
});
