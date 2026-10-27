/**
 * ROK-1956 (U-9) — the shared bounded body reader. The route supplies the
 * error factory; these specs use a tagged one so each refusal is named.
 */
import { PassThrough } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { COMPANION_MESSAGE_MAX_BYTES } from '@raid-ledger/contract';
import {
  readBoundedBody,
  type BoundedBodyErrors,
  type BoundedBodyStream,
} from './bounded-body.reader';

class Refusal extends Error {
  constructor(readonly kind: string) {
    super(kind);
  }
}

const errors: BoundedBodyErrors = {
  tooLarge: () => new Refusal('too_large'),
  unsupported: (what) => new Refusal(`unsupported:${what}`),
  badGzip: () => new Refusal('bad_gzip'),
};

const CAP = COMPANION_MESSAGE_MAX_BYTES;
const opts = { maxBytes: CAP, contentType: 'application/json', errors };

function source(
  headers: Record<string, string> = { 'content-type': 'application/json' },
): BoundedBodyStream & PassThrough {
  return Object.assign(new PassThrough(), { headers });
}

async function kindOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof Refusal) return err.kind;
    throw err;
  }
  return 'resolved';
}

describe('readBoundedBody — shared (ROK-1956 U-9)', () => {
  it('returns an identity body under the 256 KiB cap', async () => {
    const src = source();
    const p = readBoundedBody(src, opts);
    src.end(Buffer.from('{"a":1}'));
    expect((await p).toString()).toBe('{"a":1}');
  });

  it('accepts exactly the cap and refuses one byte more', async () => {
    const ok = source();
    const p = readBoundedBody(ok, opts);
    ok.end(Buffer.alloc(CAP, 0x20));
    expect((await p).length).toBe(CAP);
    const over = source();
    const q = readBoundedBody(over, opts);
    // Ended, so a broken cap resolves (→ 'resolved') instead of hanging.
    over.end(Buffer.alloc(CAP + 1, 0x20));
    expect(await kindOf(q)).toBe('too_large');
    expect(over.readableFlowing).toBe(false);
  });

  it('refuses a Content-Length over the cap without reading a byte', async () => {
    const src = source({
      'content-type': 'application/json',
      'content-length': String(CAP + 1),
    });
    expect(await kindOf(readBoundedBody(src, opts))).toBe('too_large');
    expect(src.readableFlowing).toBeNull();
  });

  it('refuses a gzip bomb (tiny on the wire) the moment inflation crosses 256 KiB', async () => {
    const bomb = gzipSync(Buffer.alloc(CAP * 8, 0x20));
    expect(bomb.length).toBeLessThan(CAP / 64);
    const src = source({
      'content-type': 'application/json',
      'content-encoding': 'gzip',
    });
    const p = readBoundedBody(src, opts);
    src.end(bomb);
    expect(await kindOf(p)).toBe('too_large');
  });
});

describe('readBoundedBody — encodings and media types (ROK-1956)', () => {
  it('inflates a gzip body under the cap', async () => {
    const src = source({
      'content-type': 'application/json',
      'content-encoding': 'gzip',
    });
    const p = readBoundedBody(src, opts);
    src.end(gzipSync(Buffer.from('{"b":2}')));
    expect((await p).toString()).toBe('{"b":2}');
  });

  it('maps a corrupt gzip to the badGzip factory', async () => {
    const src = source({
      'content-type': 'application/json',
      'content-encoding': 'gzip',
    });
    const p = readBoundedBody(src, opts);
    src.end(Buffer.from('not gzip at all'));
    expect(await kindOf(p)).toBe('bad_gzip');
  });

  it('refuses br and a wrong media type before reading', async () => {
    const br = source({
      'content-type': 'application/json',
      'content-encoding': 'br',
    });
    expect(await kindOf(readBoundedBody(br, opts))).toBe(
      'unsupported:content-encoding',
    );
    const text = source({ 'content-type': 'text/plain' });
    expect(await kindOf(readBoundedBody(text, opts))).toBe(
      'unsupported:content-type',
    );
    expect(text.readableFlowing).toBeNull();
  });

  it('prefers the bypassed rawContentType over the header and ignores parameters', async () => {
    const src = source({});
    const p = readBoundedBody(src, {
      ...opts,
      rawContentType: 'Application/JSON; charset=utf-8',
    });
    src.end(Buffer.from('{}'));
    expect((await p).toString()).toBe('{}');
  });
});
