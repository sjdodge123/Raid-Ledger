import * as fs from 'node:fs';
import * as readline from 'node:readline';
import { createGunzip } from 'node:zlib';
import { PassThrough, Transform, type Readable } from 'node:stream';
import { isGzipped } from './log-files.helpers';

/**
 * Passes at most `max` bytes, then ends its readable side and calls
 * `onLimit` so the caller can stop reading (a gzip bomb stops inflating).
 */
export class ByteLimit extends Transform {
  private seen = 0;
  truncated = false;

  constructor(
    private readonly max: number,
    private readonly onLimit: () => void,
  ) {
    super();
  }

  override _transform(chunk: Buffer, _enc: string, done: () => void) {
    if (this.truncated) return done();
    const room = this.max - this.seen;
    this.seen += chunk.length;
    if (chunk.length <= room) {
      this.push(chunk);
      return done();
    }
    this.truncated = true;
    if (room > 0) this.push(chunk.subarray(0, room));
    this.push(null);
    this.onLimit();
    done();
  }
}

function openSources(filepath: string): Readable[] {
  const file = fs.createReadStream(filepath);
  return isGzipped(filepath) ? [file, file.pipe(createGunzip())] : [file];
}

/** Feed scrubbed lines from `rl` into `out`, pausing on backpressure. */
function pumpLines(
  rl: readline.Interface,
  out: PassThrough,
  scrub: (line: string) => string,
  onClose: () => void,
) {
  rl.on('line', (line) => {
    if (out.write(scrub(line) + '\n')) return;
    rl.pause();
    out.once('drain', () => rl.resume());
  });
  rl.on('close', onClose);
}

/**
 * Stream a log as scrubbed text (ROK-1164). A `.gz` is decompressed first.
 * At most `maxBytes` of (decompressed) input is read — past that the file
 * is cut off with a marker line, so a small `.gz` cannot inflate without
 * bound, nor readline buffer an endless newline-less line. Destroying the
 * returned stream (the client went away) tears the whole chain down.
 */
export function createBoundedScrubbedStream(
  filepath: string,
  maxBytes: number,
  scrub: (line: string) => string,
): Readable {
  const sources = openSources(filepath);
  const stopSources = () => sources.forEach((s) => s.destroy());
  const limiter = new ByteLimit(maxBytes, stopSources);
  sources[sources.length - 1].pipe(limiter);
  const out = new PassThrough();
  const rl = readline.createInterface({ input: limiter, crlfDelay: Infinity });
  pumpLines(rl, out, scrub, () => {
    if (limiter.truncated) {
      const mb = Math.round(maxBytes / 1024 / 1024);
      out.write(`[truncated: log exceeds the ${mb} MB download limit]\n`);
    }
    out.end();
  });
  for (const s of sources) s.on('error', (err) => out.destroy(err));
  out.on('close', () => {
    rl.close();
    stopSources();
    limiter.destroy();
  });
  return out;
}
