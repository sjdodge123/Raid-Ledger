import { PassThrough } from 'node:stream';
import { gzipSync } from 'node:zlib';
import {
  readBoundedBody,
  type BoundedBodySource,
} from './valheim-link-body.reader';
import { rejection } from './valheim-link-ingest.testing';

const CAP = 1024;
const opts = { maxBytes: CAP, contentType: 'application/json' };

function source(
  headers: Record<string, string> = {},
): BoundedBodySource & PassThrough {
  return Object.assign(new PassThrough(), {
    headers,
    valheimLinkContentType: 'application/json; charset=utf-8',
  });
}

const code = (c: string) => expect.objectContaining({ code: c });

describe('readBoundedBody (ROK-1833)', () => {
  it('returns an identity body under the cap', async () => {
    const src = source();
    const p = readBoundedBody(src, opts);
    src.end(Buffer.from('{"a":1}'));
    expect((await p).toString()).toBe('{"a":1}');
  });

  it('413s on a Content-Length over the cap without reading a byte', async () => {
    const src = source({ 'content-length': String(CAP + 1) });
    const r = await rejection(readBoundedBody(src, opts));
    expect(r).toEqual({ status: 413, body: code('payload_too_large') });
    expect(src.readableFlowing).toBeNull();
  });

  it('413s the moment a streamed body crosses the cap (stream never ended)', async () => {
    const src = source();
    const p = readBoundedBody(src, opts);
    src.write(Buffer.alloc(CAP + 1, 0x20));
    expect(await rejection(p)).toEqual({
      status: 413,
      body: code('payload_too_large'),
    });
    expect(src.readableFlowing).toBe(false);
  });

  it('inflates a gzip body under the cap', async () => {
    const src = source({ 'content-encoding': 'gzip' });
    const p = readBoundedBody(src, opts);
    src.end(gzipSync(Buffer.from('{"b":2}')));
    expect((await p).toString()).toBe('{"b":2}');
  });

  it('413s a gzip bomb whose inflation passes the cap (tiny on the wire)', async () => {
    const bomb = gzipSync(Buffer.alloc(CAP * 64, 0x20));
    expect(bomb.length).toBeLessThan(CAP);
    const src = source({ 'content-encoding': 'gzip' });
    const p = readBoundedBody(src, opts);
    src.write(bomb);
    expect(await rejection(p)).toEqual({
      status: 413,
      body: code('payload_too_large'),
    });
  });

  it('400 bad_gzip on a body that is not gzip', async () => {
    const src = source({ 'content-encoding': 'gzip' });
    const p = readBoundedBody(src, opts);
    src.end(Buffer.from('not gzip at all'));
    expect(await rejection(p)).toEqual({ status: 400, body: code('bad_gzip') });
  });

  it.each(['br', 'deflate', 'gzip, br'])(
    '415 on Content-Encoding %s',
    async (enc) => {
      const r = await rejection(
        readBoundedBody(source({ 'content-encoding': enc }), opts),
      );
      expect(r).toEqual({ status: 415, body: code('unsupported_media') });
    },
  );

  it('415 on a media type other than the route’s', async () => {
    const src = Object.assign(new PassThrough(), {
      headers: {},
      valheimLinkContentType: 'text/plain',
    });
    const r = await rejection(readBoundedBody(src, opts));
    expect(r).toEqual({ status: 415, body: code('unsupported_media') });
  });
});
