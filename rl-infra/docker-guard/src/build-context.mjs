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

/**
 * The decompressing feed for a sniffed context. c7: every gunzip handler is
 * registered HERE, before a byte is written, so an early header error can never
 * settle ahead of its listener (that left the upload hanging forever).
 */
function makeFeed(kind, scanner, { fail, finish }) {
  if (kind === 'tar') return { write: (c) => scanner.push(c), end: finish };
  if (kind !== 'gzip') return { write: () => {}, end: finish };
  const gz = zlib.createGunzip();
  gz.on('data', (c) => scanner.push(c));
  gz.on('error', () => fail('corrupt'));
  gz.once('end', finish);
  return { write: (c) => gz.write(c), end: () => gz.end(), destroy: () => gz.destroy() };
}

/**
 * Stream `req` into the spool `out` while feeding the scanner. Resolves
 * { size, kind, code? } exactly once; kind 'aborted' | 'corrupt' | 'spool_error'
 * are failures. c7: spool errors (ENOSPC) settle this upload, never the process.
 */
function pump(req, out, scanner) {
  return new Promise((resolve) => {
    let head = Buffer.alloc(0);
    let feed = null;
    let settled = false;
    let size = 0;
    let kind = 'tar';
    const done = (k, code) => { if (!settled) { settled = true; resolve({ size, kind: k, code }); } };
    const fail = (k, code) => { feed?.destroy?.(); out.destroy(); req.resume(); done(k, code); };
    const finish = () => out.end(() => done(kind));
    const begin = (buf) => { kind = sniff(buf); feed = makeFeed(kind, scanner, { fail, finish }); feed.write(buf); };
    out.on('error', (e) => fail('spool_error', e.code));
    req.on('data', (c) => {
      if (settled) return;
      size += c.length;
      if (!out.write(c)) { req.pause(); out.once('drain', () => req.resume()); }
      if (feed) return feed.write(c);
      head = Buffer.concat([head, c]);
      if (head.length >= 6) begin(head);
    });
    req.on('error', () => fail('aborted'));
    req.on('end', () => { if (settled) return; if (!feed) begin(head); feed.end(); });
  });
}

const FAILED = {
  aborted: () => ({ status: 400, reason: 'build context upload aborted' }),
  corrupt: () => ({ status: 400, reason: 'gzip build context is corrupt' }),
  spool_error: (code) => ({ status: code === 'ENOSPC' ? 507 : 500, reason: `build context could not be spooled (${code ?? 'write error'})` }),
};

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
  const { size, kind, code } = await pump(req, fs.createWriteStream(file), scanner);
  const policy = (reason) => ({ cleanup, error: { status: 403, reason: `build_dockerfile_policy: ${reason}` } });
  if (FAILED[kind]) {
    cleanup();
    return { cleanup, error: FAILED[kind](code) };
  }
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
