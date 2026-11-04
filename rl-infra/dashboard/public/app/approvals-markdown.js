// ROK-1900 — a tiny SAFE markdown renderer for an approval item's spec.
//
// The spec text is agent-written, so it is untrusted: this module builds DOM
// nodes and only ever sets text through textContent / text nodes — never
// innerHTML. Raw HTML in the source stays visible as literal text.
//
// Subset: # headings, - / * / 1. lists, ``` fenced code, `inline code`,
// **bold**, *italic* / _italic_, [links](https://…) and | table | rows
// (shown as preformatted text). A link becomes an <a> only for https: URLs,
// with rel="noopener noreferrer"; anything else (javascript:, data:, http:,
// relative) renders as its plain label.

(function attachApprovalsMarkdown() {
  const NS = (window.__rlApprovals = window.__rlApprovals || {});

  // Inline parsing is a hand-written scan, not a regex: every delimiter
  // search goes through `nextOf`, which caches the next index per character,
  // so a line full of unclosed `[`, `*`, `_` or backticks stays linear (the
  // old alternation regex was quadratic — 154 ms for 20k `[`).
  const WORD = /[A-Za-z0-9_]/;
  const SPACE = /\s/;
  const scanner = (text) => {
    const cache = new Map();
    return (ch, from) => {
      const hit = cache.get(ch);
      if (hit !== undefined && (hit === -1 || hit >= from)) return hit;
      const j = text.indexOf(ch, from);
      cache.set(ch, j);
      return j;
    };
  };

  // One inline token starting at i, or null. Mirrors the old regex order:
  // `code`, [label](url), **bold**, *ital*, _ital_.
  const tokenAt = (text, i, nextOf, urlOk) => {
    const c = text[i];
    if (c === '`') {
      const j = nextOf('`', i + 1);
      return j > i + 1 ? { end: j + 1, code: text.slice(i + 1, j) } : null;
    }
    if (c === '[') {
      const j = nextOf(']', i + 1);
      if (j <= i + 1 || text[j + 1] !== '(') return null;
      if (!urlOk.has(j)) {
        const k = nextOf(')', j + 2);
        const url = k > j + 2 ? text.slice(j + 2, k) : '';
        urlOk.set(j, url && !SPACE.test(url) ? { k, url } : null);
      }
      const u = urlOk.get(j);
      return u ? { end: u.k + 1, label: text.slice(i + 1, j), url: u.url } : null;
    }
    if (c === '*' && text[i + 1] === '*') {
      const j = nextOf('*', i + 2);
      return j > i + 2 && text[j + 1] === '*' ? { end: j + 2, tag: 'strong', inner: text.slice(i + 2, j) } : null;
    }
    if (c === '*') {
      const n = text[i + 1];
      if (n === undefined || SPACE.test(n)) return null;
      const j = nextOf('*', i + 1);
      return j > i + 1 ? { end: j + 1, tag: 'em', inner: text.slice(i + 1, j) } : null;
    }
    if (c === '_' && !(i > 0 && WORD.test(text[i - 1]))) {
      const j = nextOf('_', i + 1);
      if (j <= i + 1 || (j + 1 < text.length && WORD.test(text[j + 1]))) return null;
      return { end: j + 1, tag: 'em', inner: text.slice(i + 1, j) };
    }
    return null;
  };

  const safeHttps = (u) => {
    try { return new URL(u).protocol === 'https:' ? new URL(u).href : null; } catch { return null; }
  };

  const el = (doc, tag, text) => {
    const n = doc.createElement(tag);
    if (text !== undefined) n.textContent = text;
    return n;
  };

  const appendToken = (doc, parent, t) => {
    if (t.code !== undefined) return parent.append(el(doc, 'code', t.code));
    if (t.label !== undefined) {
      const href = safeHttps(t.url);
      if (!href) return parent.append(doc.createTextNode(t.label));
      const a = el(doc, 'a', t.label);
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      return parent.append(a);
    }
    const n = el(doc, t.tag);
    inline(doc, n, t.inner); // eslint-disable-line no-use-before-define
    return parent.append(n);
  };

  // Appends the inline-formatted `text` to `parent`. Bold/italic content is
  // itself parsed (so **[a](https://x)** works); code spans are literal.
  function inline(doc, parent, text) {
    const nextOf = scanner(text);
    const urlOk = new Map();
    let last = 0;
    for (let i = 0; i < text.length;) {
      const t = tokenAt(text, i, nextOf, urlOk);
      if (!t) { i += 1; continue; }
      if (i > last) parent.append(doc.createTextNode(text.slice(last, i)));
      appendToken(doc, parent, t);
      i = t.end;
      last = i;
    }
    if (last < text.length) parent.append(doc.createTextNode(text.slice(last)));
  }

  // A heading's text without the optional closing #-run ("## Title ##").
  const headingText = (raw) => {
    const t = raw.trim();
    let j = t.length;
    while (j > 0 && t[j - 1] === '#') j -= 1;
    if (j === t.length) return t;
    return j === 0 || t[j - 1] === ' ' || t[j - 1] === '\t' ? t.slice(0, j).trim() : t;
  };

  // Lines longer than this are cut (with a visible marker) so no single
  // agent-written line can make the renderer do unbounded work.
  const MAX_LINE = 2000;
  const TRUNCATED = ' (line truncated)';
  const capLine = (l) => (l.length > MAX_LINE ? `${l.slice(0, MAX_LINE)}${TRUNCATED}` : l);

  const RE = {
    fence: /^\s*```/,
    heading: /^(#{1,6})\s+(.*)$/,
    ul: /^\s*[-*+]\s+(.*)$/,
    ol: /^\s*\d+[.)]\s+(.*)$/,
    table: /^\s*\|/,
    blank: /^\s*$/,
  };

  // Markdown text → DocumentFragment. Headings shift down two levels so a
  // spec's "# Title" sits under the item page's own heading.
  const renderMarkdown = (src, doc = document) => {
    const frag = doc.createDocumentFragment();
    const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n').map(capLine);
    let para = null;
    let list = null;
    const close = () => { para = null; list = null; };
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (RE.fence.test(line)) {
        close();
        const body = [];
        for (i += 1; i < lines.length && !RE.fence.test(lines[i]); i += 1) body.push(lines[i]);
        const pre = el(doc, 'pre');
        pre.append(el(doc, 'code', body.join('\n')));
        frag.append(pre);
        continue;
      }
      if (RE.table.test(line)) {
        close();
        const rows = [line];
        while (i + 1 < lines.length && RE.table.test(lines[i + 1])) { i += 1; rows.push(lines[i]); }
        frag.append(el(doc, 'pre', rows.join('\n')));
        continue;
      }
      if (RE.blank.test(line)) { close(); continue; }
      const hm = line.match(RE.heading);
      if (hm) {
        close();
        const hn = el(doc, `h${Math.min(6, hm[1].length + 2)}`);
        inline(doc, hn, headingText(hm[2] ?? ''));
        frag.append(hn);
        continue;
      }
      const lm = line.match(RE.ul) || line.match(RE.ol);
      if (lm) {
        const tag = RE.ul.test(line) ? 'ul' : 'ol';
        if (!list || list.tagName.toLowerCase() !== tag) { para = null; list = el(doc, tag); frag.append(list); }
        const li = el(doc, 'li');
        inline(doc, li, lm[1] ?? '');
        list.append(li);
        continue;
      }
      if (list && /^\s{2,}\S/.test(line) && list.lastChild) { // list item continuation
        inline(doc, list.lastChild, ` ${line.trim()}`);
        continue;
      }
      list = null;
      if (!para) { para = el(doc, 'p'); frag.append(para); } else para.append(doc.createTextNode(' '));
      inline(doc, para, line.trim());
    }
    return frag;
  };

  Object.assign(NS, { renderMarkdown, safeHttps, MAX_LINE });
})();
