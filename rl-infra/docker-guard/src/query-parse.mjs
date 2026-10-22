// ROK-1846 c5 — parse a request-target's query the way Go's url.ParseQuery
// (Docker's r.ParseForm) does, and refuse every input the two could read
// differently. WHATWG URLSearchParams stops at a raw `#` (Go keeps it) and
// turns `%FF` into U+FFFD (Go keeps byte 0xFF), so the guard never uses it.
// Accepted: printable ASCII except `#`, `?`, `;` and space; `%XX` escapes that
// decode to printable ASCII; `+` is a space. Decoded exactly once. Pure.

/** Keys Docker reads as a list (r.Form["t"]); every other key must appear once. */
const MULTI = new Set(['t']);
const RAW_OK = /^[\x21-\x7e]*$/;
const RAW_FORBIDDEN = /[#?;]/;

export class QueryError extends Error {}

/** Go's QueryUnescape restricted to printable-ASCII results; throws QueryError. */
function unescape(s) {
  const out = s.replace(/\+/g, ' ').replace(/%(.{0,2})/g, (_, hex) => {
    if (!/^[0-9A-Fa-f]{2}$/.test(hex)) throw new QueryError(`bad %-escape %${hex}`);
    const code = parseInt(hex, 16);
    if (code < 0x20 || code >= 0x7f) throw new QueryError(`%${hex} decodes to a control or non-ASCII byte`);
    return String.fromCharCode(code);
  });
  return out;
}

/** The parsed query: get() = first value (Go's Values.Get), getAll(), has(). */
class Query {
  constructor(map) { this.map = map; }
  get(k) { return this.map.get(k)?.[0] ?? null; }
  getAll(k) { return [...(this.map.get(k) ?? [])]; }
  has(k) { return this.map.has(k); }
}

/** Parse the raw query (no leading `?`). Throws QueryError on anything ambiguous. */
export function parseQuery(raw) {
  const s = String(raw);
  if (!RAW_OK.test(s)) throw new QueryError('raw non-ASCII, control or space byte in the query');
  if (RAW_FORBIDDEN.test(s)) throw new QueryError('raw #, ? or ; in the query');
  const map = new Map();
  for (const pair of s.split('&')) {
    if (pair === '') continue;
    const eq = pair.indexOf('=');
    const key = unescape(eq < 0 ? pair : pair.slice(0, eq));
    const value = eq < 0 ? '' : unescape(pair.slice(eq + 1));
    const list = map.get(key) ?? [];
    if (list.length > 0 && !MULTI.has(key)) throw new QueryError(`query key ${key} is repeated`);
    list.push(value);
    map.set(key, list);
  }
  return new Query(map);
}

/** Null when a decoded dockerfile= value is printable ASCII with no `..` segment. */
export function dockerfileParamReason(v) {
  if (v === null) return null;
  if (!/^[\x20-\x7e]*$/.test(v)) return 'dockerfile= is not printable ASCII';
  if (v.split(/[/\\]/).includes('..')) return 'dockerfile= has a .. segment';
  return null;
}
