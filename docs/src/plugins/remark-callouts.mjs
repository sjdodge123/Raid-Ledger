// Tiny, dependency-free remark plugin for Starlight-style asides in markdown pages:
//
//   :::note            ->  <aside class="callout callout-note" role="note">
//   Some **text**.          <p class="callout-title">Note</p><p>Some text.</p>
//   :::                     </aside>
//
// Without remark-directive the block parses as ordinary paragraph(s) whose first
// text starts with ":::note" and whose last text ends with ":::". We strip the
// markers and wrap the paragraph range in a node that renders as <aside>. Works
// at any depth (e.g. indented inside a list item). An unclosed opener is left as is.
const KINDS = { note: 'Note', tip: 'Tip', caution: 'Caution', danger: 'Danger' };
const OPEN = /^:::(note|tip|caution|danger)[ \t]*(?:\n|$)/;
const CLOSE = /(?:^|\n)[ \t]*:::[ \t]*$/;

function edgeText(node, last) {
  if (node?.type !== 'paragraph' || node.children.length === 0) return undefined;
  const child = node.children[last ? node.children.length - 1 : 0];
  return child.type === 'text' ? child : undefined;
}

function dropEmptyEdges(para) {
  para.children = para.children.filter((c) => !(c.type === 'text' && c.value.trim() === ''));
  const first = para.children[0];
  if (first?.type === 'text') first.value = first.value.replace(/^\s+/, '');
  const last = para.children[para.children.length - 1];
  if (last?.type === 'text') last.value = last.value.replace(/\s+$/, '');
}

function findClose(children, from) {
  for (let j = from; j < children.length; j++) {
    const t = edgeText(children[j], true);
    if (t && CLOSE.test(t.value)) return j;
  }
  return -1;
}

function wrapAt(children, i) {
  const open = edgeText(children[i], false);
  const match = open && OPEN.exec(open.value);
  if (!match) return false;
  const end = findClose(children, i);
  if (end === -1) return false;
  const body = children.slice(i, end + 1);
  const kind = match[1];
  open.value = open.value.slice(match[0].length);
  const close = edgeText(children[end], true);
  close.value = close.value.replace(CLOSE, '');
  body.forEach(dropEmptyEdges);
  const title = {
    type: 'paragraph',
    data: { hProperties: { className: ['callout-title'] } },
    children: [{ type: 'text', value: KINDS[kind] }],
  };
  children.splice(i, body.length, {
    type: 'callout',
    data: { hName: 'aside', hProperties: { className: ['callout', `callout-${kind}`], role: 'note' } },
    children: [title, ...body.filter((p) => p.children.length > 0)],
  });
  return true;
}

function walk(node) {
  if (!Array.isArray(node.children)) return;
  for (let i = 0; i < node.children.length; i++) {
    wrapAt(node.children, i);
    walk(node.children[i]);
  }
}

export default function remarkCallouts() {
  return (tree) => walk(tree);
}
