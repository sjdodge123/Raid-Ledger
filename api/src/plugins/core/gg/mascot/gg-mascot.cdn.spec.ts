/**
 * ROK-2187 — the mascot download caps the body while streaming: a chunked
 * response with no `content-length` is cut off as soon as it passes the cap,
 * never buffered whole.
 */
import { UnprocessableEntityException } from '@nestjs/common';
import { downloadMascotAsset } from './gg-mascot.cdn';
import { MASCOT_IMAGE_MAX_BYTES } from './gg-mascot.storage';

const CHUNKS = 10;
const CHUNK = new Uint8Array(MASCOT_IMAGE_MAX_BYTES / 2);

/** A chunked body (no content-length) of CHUNKS × CHUNK; counts pulls. */
function chunkedResponse(): { res: Response; pulled: () => number } {
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= CHUNKS) return controller.close();
      pulled += 1;
      controller.enqueue(CHUNK);
    },
  });
  return { res: new Response(body, { status: 200 }), pulled: () => pulled };
}

afterEach(() => jest.restoreAllMocks());

it('aborts an oversize chunked body mid-stream with a 422', async () => {
  const { res, pulled } = chunkedResponse();
  jest.spyOn(global, 'fetch').mockResolvedValue(res);
  await expect(
    downloadMascotAsset('https://cdn.discordapp.com/x.png', 'image'),
  ).rejects.toBeInstanceOf(UnprocessableEntityException);
  // Cap = 2 chunks; the 3rd pushes it over. Whole-body buffering pulls all 10.
  expect(pulled()).toBeLessThanOrEqual(4);
});

it('reads a small chunked body in full', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
  jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(new Response(new Uint8Array(png), { status: 200 }));
  const asset = await downloadMascotAsset(
    'https://cdn.discordapp.com/x.png',
    'image',
  );
  expect(asset.ext).toBe('png');
  expect(asset.buf.equals(png)).toBe(true);
});
