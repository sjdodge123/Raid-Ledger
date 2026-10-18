// ROK-1846 c1 — spool a /build context to disk while scanning it, so the
// Dockerfile the daemon will use is checked (dockerfile-policy.mjs) BEFORE a
// single byte reaches the daemon. Plain and gzip tars are inspected; bzip2 /
// xz / zstd contexts (which Docker would also decompress) are refused 415.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createTarScanner, normName } from './tar-scan.mjs';
import { dockerfileReason } from './dockerfile-policy.mjs';

const MAGIC = [['gzip', [0x1f, 0x8b]], ['bzip2', [0x42, 0x5a, 0x68]], ['xz', [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]], ['zstd', [0x28, 0xb5, 0x2f, 0xfd]]];
const sniff = (buf) => MAGIC.find(([, m]) => m.every((b, i) => buf[i] === b))?.[0] ?? 'tar';

/** The context paths the daemon may read as the Dockerfile (default falls back to `dockerfile`). */
export function dockerfileCandidates(param) {
  if (!param || param === 'Dockerfile') return ['Dockerfile', 'dockerfile'];
  return [normName(param)];
}

function pump(req, out, scanner) {
  return new Promise((resolve) => {
    let head = Buffer.alloc(0);
    let feed = null;
    let gz = null;
    let kind = 'tar';
    let size = 0;
    const begin = (buf) => {
      kind = sniff(buf);
      if (kind === 'gzip') {
        gz = zlib.createGunzip();
        gz.on('data', (c) => scanner.push(c));
        gz.on('error', () => scanner.fail('gzip build context is corrupt'));
      }
      feed = kind === 'tar' ? (c) => scanner.push(c) : gz ? (c) => gz.write(c) : () => {};
      feed(buf);
    };
    req.on('data', (c) => {
      size += c.length;
      if (!out.write(c)) {
        req.pause();
        out.once('drain', () => req.resume());
      }
      if (feed) return feed(c);
      head = Buffer.concat([head, c]);
      if (head.length >= 6) begin(head);
    });
    req.on('error', () => resolve({ size, kind: 'aborted' }));
    req.on('end', () => {
      if (!feed) begin(head);
      const fin = () => out.end(() => resolve({ size, kind }));
      if (!gz) return fin();
      gz.once('close', fin);
      gz.end();
    });
  });
}

/**
 * Spool + inspect. Resolves { error: { status, reason } } or
 * { file, size } — the caller streams `file` upstream, then calls cleanup().
 */
export async function spoolBuildContext(req, dockerfileParam, tmpDir = os.tmpdir(), opts = {}) {
  const dir = fs.mkdtempSync(path.join(tmpDir, 'rlg-ctx-'));
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  const file = path.join(dir, 'context');
  const candidates = dockerfileCandidates(dockerfileParam);
  const scanner = createTarScanner(new Set(candidates));
  const { size, kind } = await pump(req, fs.createWriteStream(file), scanner);
  const policy = (reason) => ({ cleanup, error: { status: 403, reason: `build_dockerfile_policy: ${reason}` } });
  if (kind === 'aborted') return { cleanup, error: { status: 400, reason: 'build context upload aborted' } };
  if (kind !== 'tar' && kind !== 'gzip') return { cleanup, error: { status: 415, reason: `${kind} build contexts cannot be inspected; send a plain or gzip tar` } };
  const scan = scanner.end();
  if (scan.error?.startsWith('build_context_ambiguous')) return { cleanup, error: { status: 403, reason: scan.error } };
  if (scan.error) return policy(scan.error);
  if (scan.files.length === 0) return policy(`${candidates[0]} is not in the build context`);
  for (const f of scan.files) {
    const reason = dockerfileReason(f.data, opts);
    if (reason) return policy(`${f.name}: ${reason}`);
  }
  return { cleanup, file, size };
}
