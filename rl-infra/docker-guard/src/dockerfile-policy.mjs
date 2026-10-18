// ROK-1846 c1 — what a runner's Dockerfile may do under the classic builder.
// `ADD http://127.0.0.1:2375/containers/<victim>/json /leak` makes the DAEMON
// fetch from the VM host network — the body-blind loopback proxy included — so
// remote ADD sources are refused, and so are variables that could expand to
// one. COPY --from of an infra image is refused like a pull of it. Pure.
import { parseImageRef, pullDenied } from './image-refs.mjs';

const DIRECTIVE = /^#\s*([a-zA-Z][a-zA-Z0-9]*)\s*=\s*(.+?)\s*$/;

/** Logical instruction lines: parser directives, comments and continuations resolved. */
function logicalLines(text) {
  const phys = String(text).replace(/\r\n?/g, '\n').split('\n');
  let escape = '\\';
  let i = 0;
  for (; i < phys.length; i++) {
    const m = DIRECTIVE.exec(phys[i] ?? '');
    if (!m) break;
    if (m[1]?.toLowerCase() === 'escape' && (m[2] === '`' || m[2] === '\\')) escape = m[2];
  }
  const cont = new RegExp(`${escape === '`' ? '`' : '\\\\'}[ \\t]*$`);
  const out = [];
  let cur = null;
  for (; i < phys.length; i++) {
    const line = phys[i] ?? '';
    if (line.trim().startsWith('#') || (cur !== null && line.trim() === '')) continue;
    const more = cont.test(line);
    cur = (cur ?? '') + (more ? line.replace(cont, '') : line);
    if (!more) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur !== null) out.push(cur);
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
  if (stages.has(v.toLowerCase())) return null;
  const ref = parseImageRef(v);
  if (!ref) return `COPY --from=${v} is not a stage or a valid image reference`;
  return pullDenied(ref.name) ? `COPY --from=${ref.name}: runners may not read an infra service image` : null;
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

/** Null when the Dockerfile is acceptable, else the refusal reason. */
export function dockerfileReason(text) {
  const stages = new Set();
  for (const line of logicalLines(text)) {
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
