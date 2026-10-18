// ROK-1846 c1 — a streaming tar reader that finds the build's Dockerfile the
// way Go's archive/tar (the daemon) would: PAX `path`/`size` and GNU long names
// apply to the next entry, and anything it cannot read the same way (sparse,
// base-256 sizes, star headers, unknown types) is refused, never skipped.
import path from 'node:path';

const MAX_KEEP = 1024 * 1024;
const REGULAR = new Set(['0', '\0', '7']);
const META = new Set(['x', 'g', 'L', 'K']);
const OTHER = new Set(['1', '2', '3', '4', '5', '6']);

// Names are compared as raw bytes (latin1 strings), as Go's tar.Header.Name is.
const cstr = (b, from, to) => { const s = b.subarray(from, to); const z = s.indexOf(0); return (z < 0 ? s : s.subarray(0, z)).toString('latin1'); };
const bin = (s) => Buffer.from(s, 'utf8').toString('latin1');
/** Printable form of a byte-string name for refusal messages. */
const show = (n) => JSON.stringify(Buffer.from(n, 'latin1').toString('utf8'));
/** Context-relative name: `./Dockerfile`, `/Dockerfile` and `Dockerfile` are one file. */
export const normName = (n) => path.posix.normalize(`/${n}`).slice(1).replace(/\/+$/, '');

function octal(b) {
  if ((b[0] ?? 0) & 0x80) return NaN;
  const s = b.toString('latin1').replace(/^[ \0]+|[ \0]+$/g, '');
  return s === '' ? 0 : /^[0-7]+$/.test(s) ? parseInt(s, 8) : NaN;
}

function parsePax(data) {
  const out = {};
  let pos = 0;
  while (pos < data.length) {
    const sp = data.indexOf(0x20, pos);
    const len = sp < 0 ? NaN : Number(data.toString('latin1', pos, sp));
    if (!Number.isSafeInteger(len) || len <= 0 || pos + len > data.length) return null;
    const kv = data.toString('latin1', sp + 1, pos + len - 1);
    const eq = kv.indexOf('=');
    if (eq > 0) out[kv.slice(0, eq)] = kv.slice(eq + 1);
    pos += len;
  }
  return out;
}

function onMeta(st, e) {
  const data = Buffer.concat(e.chunks);
  // Go: an empty GNU long name or PAX value keeps the ustar field (mergePAX `v == ""` → continue).
  if (e.type === 'L') return void ((st.next.gnu = cstr(data, 0, data.length) || undefined));
  if (e.type === 'K') return undefined;
  const rec = parsePax(data);
  if (!rec) return void (st.error = 'tar PAX header is malformed');
  if (Object.keys(rec).some((k) => k.startsWith('GNU.sparse'))) return void (st.error = 'sparse tar entries are not inspected');
  // Go's Next(): each x/g header REPLACES the pending PAX map (paxHdrs = parsePAX),
  // and a g header is returned as its own entry, so all pending state ends there.
  if (e.type === 'g') {
    st.next = {};
    return void (rec.path || rec.size ? (st.error = 'global PAX path/size headers are not inspected') : null);
  }
  st.next = st.next.gnu === undefined ? {} : { gnu: st.next.gnu };
  if (rec.path) st.next.pax = rec.path;
  if (rec.size) st.next.size = /^[0-9]+$/.test(rec.size) ? Number(rec.size) : NaN;
}

function endEntry(st, e) {
  if (META.has(e.type)) onMeta(st, e);
  else if (e.keep) st.files.push({ name: e.name, data: Buffer.concat(e.chunks) });
  st.entry = null;
}

/**
 * Names are cleaned as Docker does (`./`, `//`, trailing `/` → normName). Any
 * entry whose cleaned name matches a wanted one case-insensitively is a hit; a
 * second hit, or a hit not byte-equal to a wanted name after cleaning, is
 * build_context_ambiguous — the guard never guesses which one the daemon uses.
 */
function noteHit(st, wanted, rawName, name) {
  if (!st.fold.has(name.toLowerCase())) return;
  st.hits.push(rawName);
  if (st.hits.length > 1) st.error = `build_context_ambiguous: ${st.hits.map(show).join(' and ')} both resolve to the Dockerfile`;
  else if (!wanted.has(name)) st.error = `build_context_ambiguous: ${show(rawName)} only resembles the Dockerfile name`;
}

function onHeader(st, wanted, h) {
  if (h.every((b) => b === 0)) return void (st.done = true);
  let type = String.fromCharCode(h[156] ?? 0);
  if (!REGULAR.has(type) && !META.has(type) && !OTHER.has(type)) return void (st.error = `tar entry type ${JSON.stringify(type)} is not inspected`);
  const ustar = h.toString('latin1', 257, 263) === 'ustar\0';
  if (ustar && h.toString('latin1', 508, 512) === 'tar\0') return void (st.error = 'star-format tar headers are not inspected');
  const meta = META.has(type);
  const size = meta ? octal(h.subarray(124, 136)) : st.next.size ?? octal(h.subarray(124, 136));
  if (!Number.isSafeInteger(size) || size < 0) return void (st.error = 'tar size field is not inspectable');
  const prefix = ustar ? cstr(h, 345, 500) : '';
  const raw = prefix ? `${prefix}/${cstr(h, 0, 100)}` : cstr(h, 0, 100);
  // Go order: mergePAX sets Name, then a non-empty GNU long name overrides it.
  const rawName = meta ? raw : st.next.gnu ?? st.next.pax ?? raw;
  const name = normName(rawName);
  // c5: Go's Next() turns TypeRegA ('\0') with a trailing-`/` final name into
  // TypeDir — a body-less entry whatever its size field says.
  if (type === '\0' && rawName.endsWith('/')) type = '5';
  if (!meta) {
    st.next = {};
    noteHit(st, wanted, rawName, name);
    if (st.error) return;
  }
  if (OTHER.has(type) && type !== '5') st.links.push(name);
  const keep = meta || (REGULAR.has(type) && wanted.has(name));
  if (keep && size > MAX_KEEP) return void (st.error = `${name} is over 1 MiB`);
  // c4: Go's archive/tar (handleRegularFile → isHeaderOnlyType) gives links,
  // devices, dirs and fifos NO body whatever the size field says; only regular
  // and meta entries have `size` bytes. Unmodelled types were refused above.
  const body = OTHER.has(type) ? 0 : size;
  const total = body + ((512 - (body % 512)) % 512);
  st.entry = { type, name, keep, chunks: [], data: body, total, left: total };
  if (st.entry.left === 0) endEntry(st, st.entry);
}

function consume(st) {
  const e = st.entry;
  const take = Math.min(st.buf.length, e.left);
  const want = Math.max(0, Math.min(take, e.data - (e.total - e.left)));
  if (e.keep && want) e.chunks.push(st.buf.subarray(0, want));
  st.buf = st.buf.subarray(take);
  e.left -= take;
  if (e.left === 0) endEntry(st, e);
  return st.entry === null;
}

/** Scanner for the context-relative names in `wanted`. push(chunk) … end() → { files, error }. */
export function createTarScanner(wantedNames) {
  const wanted = new Set([...wantedNames].map(bin));
  const fold = new Set([...wanted].map((w) => w.toLowerCase()));
  const st = { buf: Buffer.alloc(0), entry: null, next: {}, files: [], links: [], hits: [], fold, error: null, done: false };
  const push = (chunk) => {
    if (st.done || st.error) return;
    st.buf = st.buf.length ? Buffer.concat([st.buf, chunk]) : chunk;
    while (!st.done && !st.error) {
      if (st.entry) {
        if (!consume(st)) return;
        continue;
      }
      if (st.buf.length < 512) return;
      const block = st.buf.subarray(0, 512);
      st.buf = st.buf.subarray(512);
      onHeader(st, wanted, block);
    }
  };
  const end = () => {
    if (!st.error && (st.entry || (!st.done && st.buf.length))) st.error = 'build context tar is truncated';
    const linked = [...wanted].find((w) => st.links.some((l) => w === l || w.startsWith(`${l}/`)));
    if (!st.error && linked) st.error = `${linked} is (inside) a link entry`;
    return { files: st.files.map((f) => ({ ...f, name: Buffer.from(f.name, 'latin1').toString('utf8') })), error: st.error };
  };
  return { push, end, fail: (reason) => { st.error ??= reason; } };
}
