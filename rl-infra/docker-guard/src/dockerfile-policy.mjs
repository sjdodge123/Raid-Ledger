// ROK-1846 c1 — what a runner's Dockerfile may do under the classic builder.
// `ADD http://127.0.0.1:2375/containers/<victim>/json /leak` makes the DAEMON
// fetch from the VM host network — the body-blind loopback proxy included — so
// remote ADD sources are refused, and so are variables that could expand to
// one. COPY --from of an infra image is refused like a pull of it. Pure.
import { parseImageRef, pullDenied } from './image-refs.mjs';
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

const unquote = (v) => v.replace(/^(["'])(.*)\1$/, '$2');
// Word processing strips quotes and escapes (`htt\p://` is http://).
const bare = (v) => v.replace(/["'\\`]/g, '');

function fromReason(value, stages) {
  const v = unquote(value);
  if (v.includes('$')) return `COPY --from=${v}: a variable --from could name any image`;
  const ref = parseImageRef(v);
  // Checked before stage aliases: a reading may see a FROM … AS <infra-name> line.
  if (ref && pullDenied(ref.name)) return `COPY --from=${ref.name}: runners may not read an infra service image`;
  if (stages.has(v.toLowerCase())) return null;
  return ref ? null : `COPY --from=${v} is not a stage or a valid image reference`;
}

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

function copyReason(instr, rest, stages) {
  let s = rest;
  for (let m = /^\s*--(\S+)/.exec(s); m; m = /^\s*--(\S+)/.exec(s)) {
    const from = /^from=([\s\S]*)$/i.exec(m[1] ?? '');
    const r = from ? fromReason(from[1] ?? '', stages) : null;
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

function readingReason(lines) {
  const stages = new Set();
  for (const line of lines) {
    let [instr, rest] = splitInstr(line);
    if (instr === 'ONBUILD') [instr, rest] = splitInstr(rest);
    if (instr === 'FROM') {
      const alias = /\sAS\s+(\S+)\s*$/i.exec(rest);
      if (alias?.[1]) stages.add(alias[1].toLowerCase());
      stages.add(String(stages.size));
      continue;
    }
    const r = instr === 'ADD' || instr === 'COPY' ? copyReason(instr, rest, stages) : null;
    if (r) return r;
  }
  return null;
}

/** Null when the Dockerfile is acceptable under every reading, else the refusal reason. */
export function dockerfileReason(text) {
  for (const lines of readings(text)) {
    const r = readingReason(lines);
    if (r) return r;
  }
  return null;
}
