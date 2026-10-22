// ROK-1846 c1 — what a runner's Dockerfile may do under the classic builder.
// `ADD http://127.0.0.1:2375/containers/<victim>/json /leak` makes the DAEMON
// fetch from the VM host network — the body-blind loopback proxy included — so
// remote ADD sources are refused, and so are variables that could expand to
// one. COPY --from of an infra image is refused like a pull of it. Pure.
import { baseImageReason, splitFrom } from './base-image-policy.mjs';
import { astReading } from './dockerfile-ast-reading.mjs';

const DIRECTIVE = /^#[ \t]*([a-zA-Z][a-zA-Z0-9]*)[ \t]*=[ \t]*(.+?)[ \t]*$/;
const isComment = (l) => /^\s*#/.test(l);
const ESC = { '\\': '\\\\', '`': '`' };

/** Physical lines as Go's bufio.ScanLines yields them: split on \n, one trailing \r dropped, BOM stripped. */
function physLines(text) {
  return String(text).replace(/^\uFEFF/, '').split('\n').map((l) => l.replace(/\r$/, ''));
}

/** The `# escape=` token BuildKit's directive parser would honour (default `\`). */
function declaredEscape(lines) {
  for (const line of lines) {
    const m = DIRECTIVE.exec(line);
    if (!m) break;
    if (m[1]?.toLowerCase() === 'escape' && (m[2] === '`' || m[2] === '\\')) return m[2];
  }
  return '\\';
}

/**
 * One continuation model of BuildKit's parser loop: `#` lines and blank lines
 * inside a continuation are skipped, trailing [ \t] after the escape is ignored,
 * a continuation at EOF ends the instruction. `strict` is BuildKit's
 * `([^e])e[ \t]*$|^e[ \t]*$` (an escaped escape is not a continuation, a lone
 * escape on its own line is — c3); the loose form is the older `e[ \t]*$`.
 */
function joined(lines, esc, strict) {
  const e = ESC[esc] ?? '\\\\';
  const re = strict ? new RegExp(`([^${e}])${e}[ \\t]*$|^${e}[ \\t]*$`) : new RegExp(`${e}[ \\t]*$`);
  const trim = (l) => (re.test(l) ? [l.replace(re, strict ? '$1' : ''), true] : [l, false]);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (isComment(lines[i] ?? '')) continue;
    let [cur, more] = trim((lines[i] ?? '').replace(/^\s+/, ''));
    while (more && ++i < lines.length) {
      const l = lines[i] ?? '';
      if (isComment(l) || l.trim() === '') continue;
      const [c, m] = trim(l);
      cur += c;
      more = m;
    }
    if (cur.trim() !== '') out.push(cur);
  }
  return out;
}

/**
 * Every reading the policy must hold under: the declared escape and both
 * tokens, BuildKit's strict and the legacy loose continuation rule, and — the
 * hard backstop — each physical line on its own (split on \r too), so no
 * continuation or heredoc mis-model can hide an `ADD`/`COPY` line — plus the
 * dockerfile-ast instruction stream (c3).
 */
function readings(text) {
  const lines = physLines(text);
  const escapes = [...new Set([declaredEscape(lines), '\\', '`'])];
  const out = escapes.flatMap((esc) => [joined(lines, esc, true), joined(lines, esc, false)]);
  out.push(String(text).replace(/^\uFEFF/, '').split(/[\r\n]/).filter((l) => !isComment(l)));
  out.push(astReading(text));
  return out;
}

function splitInstr(line) {
  const m = /^\s*(\S+)\s*([\s\S]*)$/.exec(line);
  return m ? [m[1]?.toUpperCase() ?? '', m[2] ?? ''] : ['', ''];
}

// Word processing strips quotes and escapes (`htt\p://` is http://).
const bare = (v) => v.replace(/["'\\`]/g, '');

const unquote = (v) => v.replace(/^(["'])(.*)\1$/, '$2');

function sourcesOf(rest) {
  const t = rest.trim();
  if (t.startsWith('[')) {
    try {
      const list = JSON.parse(t);
      if (Array.isArray(list)) return list.map(String).slice(0, -1);
    } catch { /* shell form */ }
  }
  return t.split(/\s+/).slice(0, -1);
}

function copyReason(instr, rest, stages, opts) {
  let s = rest;
  for (let m = /^\s*--(\S+)/.exec(s); m; m = /^\s*--(\S+)/.exec(s)) {
    const from = /^from=([\s\S]*)$/i.exec(m[1] ?? '');
    const r = from ? baseImageReason('COPY --from=', unquote(from[1] ?? ''), stages, opts) : null;
    if (r) return r;
    s = s.slice(m[0].length);
  }
  if (instr !== 'ADD') return null;
  for (const src of sourcesOf(s)) {
    if (bare(src).includes('://')) return `ADD ${src}: a remote source makes the daemon fetch a URL from the VM host network`;
    if (src.includes('$')) return `ADD ${src}: a variable source could expand to a URL`;
  }
  return null;
}

function readingReason(lines, opts) {
  const stages = new Set();
  let index = 0;
  for (const line of lines) {
    let [instr, rest] = splitInstr(line);
    if (instr === 'ONBUILD') [instr, rest] = splitInstr(rest);
    if (instr === 'FROM') {
      // c5: every FROM is a (possible) pull — the image policy applies to it.
      const { image, alias } = splitFrom(rest);
      const r = baseImageReason('FROM', image, stages, opts);
      if (r) return r;
      if (alias) stages.add(alias.toLowerCase());
      stages.add(String(index++));
      continue;
    }
    const r = instr === 'ADD' || instr === 'COPY' ? copyReason(instr, rest, stages, opts) : null;
    if (r) return r;
  }
  return null;
}

// c4: BuildKit trims Go unicode.IsSpace (U+0085, U+00A0, …) that no JS reading
// models, so the whole class is closed up front: valid UTF-8, one optional BOM at
// byte 0, then only printable ASCII plus \t \n \r. The readings stay as
// defence-in-depth behind this gate.
const NOT_ASCII = /[^\t\n\r\x20-\x7e]/;

/** The Dockerfile as text (BOM at byte 0 stripped) or null when its bytes are not valid UTF-8. */
function decode(input) {
  if (!Buffer.isBuffer(input)) return String(input).replace(/^\uFEFF/, '');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(input);
  } catch {
    return null;
  }
}

/** `non_ascii: …` when the Dockerfile holds anything but printable ASCII, \t, \n, \r. */
function asciiReason(text) {
  if (text === null) return 'non_ascii: the Dockerfile is not valid UTF-8';
  const m = NOT_ASCII.exec(text);
  if (!m) return null;
  const cp = (m[0].codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0');
  return `non_ascii: U+${cp} at offset ${m.index}; Dockerfiles in a build context must be ASCII`;
}

/**
 * Null when the Dockerfile (Buffer or string) is acceptable under every
 * reading, else the refusal reason. Non-ASCII content is refused first.
 * `opts.pull` is /build?pull= (a base outside the public allowlist may not be pulled).
 */
export function dockerfileReason(input, opts = {}) {
  const text = decode(input);
  const bad = asciiReason(text);
  if (bad || text === null) return bad;
  for (const lines of readings(text)) {
    const r = readingReason(lines, opts);
    if (r) return r;
  }
  return null;
}
