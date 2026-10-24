import sharp from 'sharp';
import { BaseMapMaskError } from './valheim-map-mask.helpers';
import { renderMaskedBaseMap } from './valheim-map-mask.render';

const N = 64;

/** Explored = the south half (py < 32) → PNG rows 32..63 survive. */
function southHalfBits(n = N): Uint8Array {
  const bits = new Uint8Array((n * n) / 8);
  bits.fill(0xff, 0, (n * n) / 16);
  return bits;
}

async function sourcePng(channels: 3 | 4, n = N): Promise<Buffer> {
  const raw = Buffer.alloc(n * n * channels);
  for (let p = 0; p < n * n; p += 1) {
    raw[p * channels] = (p % 200) + 20;
    raw[p * channels + 1] = 90;
    raw[p * channels + 2] = 160;
    if (channels === 4) raw[p * channels + 3] = 255;
  }
  return sharp(raw, { raw: { width: n, height: n, channels } })
    .png()
    .toBuffer();
}

async function decode(png: Buffer) {
  return sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

function at(raw: Buffer, px: number, row: number): number[] {
  const o = (row * N + px) * 4;
  return Array.from(raw.subarray(o, o + 4));
}

describe('renderMaskedBaseMap', () => {
  it.each([3, 4] as const)(
    'RGB%s input → RGBA PNG, unexplored 0,0,0,0, explored byte-identical',
    async (channels) => {
      const png = await sourcePng(channels);
      const src = await decode(png);
      const out = await decode(
        await renderMaskedBaseMap(png, N, southHalfBits()),
      );
      expect(out.info).toMatchObject({ width: N, height: N, channels: 4 });
      expect(at(out.data, 7, 0)).toEqual([0, 0, 0, 0]);
      expect(at(out.data, 7, 31)).toEqual([0, 0, 0, 0]);
      const south = N * 32 * 4;
      expect(Buffer.from(out.data.subarray(south))).toEqual(
        Buffer.from(src.data.subarray(south)),
      );
    },
  );

  it('fails closed on a size mismatch (no bytes)', async () => {
    const png = await sourcePng(3, 128);
    await expect(renderMaskedBaseMap(png, N, southHalfBits())).rejects.toThrow(
      BaseMapMaskError,
    );
  });

  it('fails closed on undecodable input', async () => {
    await expect(
      renderMaskedBaseMap(Buffer.from('not a png'), N, southHalfBits()),
    ).rejects.toThrow(BaseMapMaskError);
    await expect(
      renderMaskedBaseMap('/nonexistent/base-map.png', N, southHalfBits()),
    ).rejects.toThrow('base map could not be masked');
  });
});
