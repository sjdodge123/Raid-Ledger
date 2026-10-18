import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rejection } from '../ingest/valheim-link-ingest.testing';
import { readBlobToFile } from './valheim-link-blob.reader';
import { blobSource, fakePng, sha256Of } from './valheim-link-blob.testing';
import { pngHeader } from './valheim-link-png.helpers';

const CAP = 1024;
const code = (c: string) => expect.objectContaining({ code: c });
let dir: string;
let tmpPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'vl-blob-reader-'));
  tmpPath = join(dir, 'upload.tmp');
});

const opts = () => ({ maxBytes: CAP, maxEdge: 16_384, tmpPath });

describe('readBlobToFile (ROK-1833)', () => {
  it('streams a valid PNG to the temp file and reports hash, length, dims', async () => {
    const png = fakePng(3, 2, 100);
    const src = blobSource();
    const p = readBlobToFile(src, opts());
    src.write(png.subarray(0, 5)); // header split across chunks
    src.end(png.subarray(5));
    expect(await p).toEqual({
      sha256: sha256Of(png),
      byteLength: png.length,
      width: 3,
      height: 2,
    });
    expect(readFileSync(tmpPath).equals(png)).toBe(true);
  });

  it('413s on a declared Content-Length over the cap without creating a file', async () => {
    const src = blobSource({ 'content-length': String(CAP + 1) });
    const r = await rejection(readBlobToFile(src, opts()));
    expect(r).toEqual({ status: 413, body: code('payload_too_large') });
    expect(existsSync(tmpPath)).toBe(false);
  });

  it('413s the moment a streamed body crosses the cap and removes the temp file', async () => {
    const src = blobSource();
    const p = readBlobToFile(src, opts());
    src.write(fakePng(1, 1, CAP)); // never ended
    expect(await rejection(p)).toEqual({
      status: 413,
      body: code('payload_too_large'),
    });
    expect(existsSync(tmpPath)).toBe(false);
  });

  it('a forged 20000×20000 IHDR is png_too_large from the header alone', async () => {
    const src = blobSource();
    const p = readBlobToFile(src, opts());
    src.write(pngHeader(20_000, 20_000)); // body never ends
    expect(await rejection(p)).toEqual({
      status: 400,
      body: code('png_too_large'),
    });
    expect(existsSync(tmpPath)).toBe(false);
  });

  it('a non-PNG is not_png on its first bytes; a short body is bad_ihdr', async () => {
    const jpeg = blobSource();
    const p1 = readBlobToFile(jpeg, opts());
    jpeg.write(Buffer.from([0xff, 0xd8, 0xff]));
    expect((await rejection(p1)).body).toEqual(code('not_png'));
    const short = blobSource();
    const p2 = readBlobToFile(short, { ...opts(), tmpPath: `${tmpPath}2` });
    short.end(pngHeader(1, 1).subarray(0, 20));
    expect((await rejection(p2)).body).toEqual(code('bad_ihdr'));
    expect(existsSync(`${tmpPath}2`)).toBe(false);
  });

  it('415s on gzip or a non-PNG media type', async () => {
    const gz = blobSource({ 'content-encoding': 'gzip' });
    expect((await rejection(readBlobToFile(gz, opts()))).status).toBe(415);
    const json = Object.assign(blobSource(), {
      valheimLinkContentType: 'application/json',
    });
    expect((await rejection(readBlobToFile(json, opts()))).status).toBe(415);
  });
});
