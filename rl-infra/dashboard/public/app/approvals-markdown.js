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

  const INLINE = /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|(?<![\w])_([^_]+)_(?![\w])/g;

  const safeHttps = (u) => {
    try { return new URL(u).protocol === 'https:' ? new URL(u).href : null; } catch { return null; }
  };

  const el = (doc, tag, text) => {
    const n = doc.createElement(tag);
    if (text !== undefined) n.textContent = text;
    return n;
  };

  // Appends the inline-formatted `text` to `parent`. Bold/italic content is
  // itself parsed (so **[a](https://x)** works); code spans are literal.
  const inline = (doc, parent, text) => {
    let last = 0;
    INLINE.lastIndex = 0;
    const matches = [...text.matchAll(INLINE)];
    for (const m of matches) {
      if (m.index > last) parent.append(doc.createTextNode(text.slice(last, m.index)));
      const [, code, label, url, bold, ital, ital2] = m;
      if (code !== undefined) parent.append(el(doc, 'code', code));
      else if (label !== undefined) {
        const href = safeHttps(url);
        if (href) {
          const a = el(doc, 'a', label);
          a.href = href;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          parent.append(a);
        } else parent.append(doc.createTextNode(label));
      } else {
        const n = el(doc, bold !== undefined ? 'strong' : 'em');
        inline(doc, n, bold ?? ital ?? ital2 ?? '');
        parent.append(n);
      }
      last = m.index + m[0].length;
    }
    if (last < text.length) parent.append(doc.createTextNode(text.slice(last)));
  };

  const RE = {
    fence: /^\s*```/,
    heading: /^(#{1,6})\s+(.*?)\s*#*\s*$/,
    ul: /^\s*[-*+]\s+(.*)$/,
    ol: /^\s*\d+[.)]\s+(.*)$/,
    table: /^\s*\|/,
    blank: /^\s*$/,
  };

  // Markdown text → DocumentFragment. Headings shift down two levels so a
  // spec's "# Title" sits under the item page's own heading.
  const renderMarkdown = (src, doc = document) => {
    const frag = doc.createDocumentFragment();
    const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
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
        inline(doc, hn, hm[2] ?? '');
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

  Object.assign(NS, { renderMarkdown, safeHttps });
})();
