import { HttpException } from '@nestjs/common';
import {
  PNG_HEADER_BYTES,
  VALHEIM_BLOB_EDGE_MAX,
  parsePngHeader,
  pngHeader,
} from './valheim-link-png.helpers';

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err: unknown) {
    if (err instanceof HttpException) {
      const body = err.getResponse();
      if (typeof body === 'object' && body !== null && 'code' in body) {
        return String(body.code);
      }
    }
    throw err;
  }
  throw new Error('expected a throw');
}

describe('parsePngHeader (ROK-1833 CONTRACT §1)', () => {
  it('reads width/height from a valid IHDR', () => {
    expect(parsePngHeader(pngHeader(1, 1), VALHEIM_BLOB_EDGE_MAX)).toEqual({
      width: 1,
      height: 1,
    });
    expect(parsePngHeader(pngHeader(2048, 512), 4096)).toEqual({
      width: 2048,
      height: 512,
    });
  });

  it('a wrong signature is not_png, even with fewer than 8 bytes', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    expect(codeOf(() => parsePngHeader(jpeg, 16_384))).toBe('not_png');
    expect(codeOf(() => parsePngHeader(Buffer.from('GIF'), 16_384))).toBe(
      'not_png',
    );
  });

  it('a truncated header is bad_ihdr', () => {
    const short = pngHeader(1, 1).subarray(0, PNG_HEADER_BYTES - 1);
    expect(codeOf(() => parsePngHeader(short, 16_384))).toBe('bad_ihdr');
  });

  it('a first chunk that is not IHDR/13 is bad_ihdr', () => {
    const wrongType = Buffer.from(pngHeader(1, 1));
    wrongType.write('IDAT', 12, 'latin1');
    expect(codeOf(() => parsePngHeader(wrongType, 16_384))).toBe('bad_ihdr');
    const wrongLen = Buffer.from(pngHeader(1, 1));
    wrongLen.writeUInt32BE(12, 8);
    expect(codeOf(() => parsePngHeader(wrongLen, 16_384))).toBe('bad_ihdr');
  });

  it('zero or oversize dimensions are png_too_large', () => {
    expect(codeOf(() => parsePngHeader(pngHeader(0, 1), 16_384))).toBe(
      'png_too_large',
    );
    expect(
      codeOf(() => parsePngHeader(pngHeader(20_000, 20_000), 16_384)),
    ).toBe('png_too_large');
    expect(codeOf(() => parsePngHeader(pngHeader(4097, 64), 4096))).toBe(
      'png_too_large',
    );
  });
});
