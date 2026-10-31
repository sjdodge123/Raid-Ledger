import sharp from 'sharp';
import {
  encodeGuildCrest,
  type GuildCrestEncodeResult,
} from './hub-crest.encode';

/** A solid test image of the given size and format. */
async function img(
  width: number,
  height: number,
  format: 'png' | 'jpeg' | 'webp' | 'gif' = 'png',
  background = '#336699',
): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background },
  })
    .toFormat(format)
    .toBuffer();
}

/** Narrow to the success branch, failing loudly otherwise. */
function ok(r: GuildCrestEncodeResult) {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}`);
  return r;
}

describe('encodeGuildCrest', () => {
  it.each(['png', 'jpeg', 'webp'] as const)('accepts %s', async (format) => {
    const r = ok(await encodeGuildCrest(await img(200, 200, format)));
    expect(r.key).toMatch(/^[0-9a-f]{32}$/);
  });

  it('outputs a 384 lg and a 128 sm square webp, even from a non-square input', async () => {
    const r = ok(await encodeGuildCrest(await img(600, 300)));
    const lg = await sharp(r.lg).metadata();
    const sm = await sharp(r.sm).metadata();
    expect([lg.format, lg.width, lg.height]).toEqual(['webp', 384, 384]);
    expect([sm.format, sm.width, sm.height]).toEqual(['webp', 128, 128]);
  });

  it('strips EXIF metadata', async () => {
    const withExif = await sharp(await img(200, 200, 'jpeg'))
      .withExif({ IFD0: { Copyright: 'secret-gps-owner' } })
      .jpeg()
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const r = ok(await encodeGuildCrest(withExif));
    expect((await sharp(r.lg).metadata()).exif).toBeUndefined();
    expect((await sharp(r.sm).metadata()).exif).toBeUndefined();
  });

  it('keys by content: same bytes → same key, different image → different key', async () => {
    const a = ok(await encodeGuildCrest(await img(200, 200)));
    const b = ok(await encodeGuildCrest(await img(200, 200)));
    const c = ok(await encodeGuildCrest(await img(200, 200, 'png', '#aa2211')));
    expect(a.key).toBe(b.key);
    expect(c.key).not.toBe(a.key);
  });
});

describe('encodeGuildCrest rejections', () => {
  it('rejects a gif as not_image', async () => {
    expect(await encodeGuildCrest(await img(200, 200, 'gif'))).toEqual({
      ok: false,
      code: 'not_image',
    });
  });

  it.each([
    [
      'svg',
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"/>',
      ),
    ],
    ['text named .png', Buffer.from('definitely not a picture')],
    ['empty', Buffer.alloc(0)],
  ])('rejects %s as not_image', async (_label, buf) => {
    expect(await encodeGuildCrest(buf)).toEqual({
      ok: false,
      code: 'not_image',
    });
  });

  it('rejects a truncated png as not_image', async () => {
    const full = await img(200, 200);
    const cut = full.subarray(0, Math.floor(full.length / 2));
    expect(await encodeGuildCrest(cut)).toEqual({
      ok: false,
      code: 'not_image',
    });
  });

  it('rejects a 63 px edge as too_small and accepts 64', async () => {
    expect(await encodeGuildCrest(await img(63, 200))).toEqual({
      ok: false,
      code: 'too_small',
    });
    ok(await encodeGuildCrest(await img(64, 64)));
  });

  it('rejects a 1025 px edge as too_big_dimensions and accepts 1024', async () => {
    expect(await encodeGuildCrest(await img(1025, 200))).toEqual({
      ok: false,
      code: 'too_big_dimensions',
    });
    ok(await encodeGuildCrest(await img(1024, 1024)));
  });
});

describe('encodeGuildCrest allowLarge (the gallery path)', () => {
  it('downsizes a 1600 × 900 picture instead of rejecting it', async () => {
    const r = ok(
      await encodeGuildCrest(await img(1600, 900), { allowLarge: true }),
    );
    const lg = await sharp(r.lg).metadata();
    expect([lg.format, lg.width, lg.height]).toEqual(['webp', 384, 384]);
  });

  it('still rejects a too-small picture', async () => {
    expect(
      await encodeGuildCrest(await img(63, 200), { allowLarge: true }),
    ).toEqual({ ok: false, code: 'too_small' });
  });
});
