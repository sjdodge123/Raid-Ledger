// ROK-1900 fix — approvals-markdown.js must stay linear on hostile input.
// Review (client) measured `# a` + 8000 spaces + `b` at 84 s (cubic heading
// regex) and 20k `[` at 154 ms (quadratic inline regex). Each worst case here
// must render in < 100 ms; the semantics the item page relies on stay put.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'app', 'approvals-markdown.js');

const load = async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
  dom.window.eval(await readFile(SRC, 'utf-8'));
  const { renderMarkdown, MAX_LINE } = dom.window.__rlApprovals;
  const render = (md) => {
    const div = dom.window.document.createElement('div');
    div.append(renderMarkdown(md, dom.window.document));
    return div;
  };
  return { render, MAX_LINE };
};

const timed = (fn) => {
  const t0 = performance.now();
  const out = fn();
  return { out, ms: performance.now() - t0 };
};

const WORST = {
  'heading: # a + 8000 spaces + b': `# a${' '.repeat(8000)}b`,
  'heading: # + 8000 spaces + #': `#${' '.repeat(8000)}#`,
  'inline: 20k [': '['.repeat(20000),
  'inline: 20k [x](': '[x]('.repeat(5000),
  'inline: 20k *': `a ${'*a'.repeat(10000)}`,
  'inline: 20k _': ` _${'x_ '.repeat(7000)}`,
  'inline: 20k backticks': `x\`${'a'.repeat(20000)}`,
  'whole 256 KB spec of unclosed [': Array.from({ length: 130 }, () => '['.repeat(1999)).join('\n'),
};

for (const [name, md] of Object.entries(WORST)) {
  test(`worst case renders in < 100 ms — ${name}`, async () => {
    const { render } = await load();
    render('# warm *up* [a](https://x.test)');
    const { ms } = timed(() => render(md));
    assert.ok(ms < 100, `${name} took ${ms.toFixed(1)} ms (budget 100 ms)`);
  });
}

test('a line over MAX_LINE is cut with a visible "(line truncated)" marker', async () => {
  const { render, MAX_LINE } = await load();
  const div = render(`para ${'x'.repeat(MAX_LINE + 500)}`);
  const text = div.textContent;
  assert.ok(text.endsWith('(line truncated)'), `marker missing: …${text.slice(-40)}`);
  assert.ok(text.length < MAX_LINE + 40, `line not cut: ${text.length} chars`);
});

test('headings: closing #-run stripped, a trailing # inside a word kept', async () => {
  const { render } = await load();
  const div = render('# Title ##\n## C#\n###   spaced   ');
  const hs = [...div.querySelectorAll('h3,h4,h5')].map((h) => `${h.tagName}:${h.textContent}`);
  assert.deepEqual(hs, ['H3:Title', 'H4:C#', 'H5:spaced']);
});

test('inline semantics: code, https link, bold, italics, snake_case left alone', async () => {
  const { render } = await load();
  const div = render('`a*b` [d](https://x.test/p) [e](http://x.test) **b [l](https://y.test)** *i* _u_ snake_case_name [bad](has space)');
  const p = must(div.querySelector('p'), 'p');
  assert.equal(p.querySelector('code')?.textContent, 'a*b');
  const links = [...p.querySelectorAll('a')].map((a) => a.getAttribute('href'));
  assert.deepEqual(links, ['https://x.test/p', 'https://y.test/']);
  assert.equal(p.querySelector('strong a')?.textContent, 'l');
  assert.deepEqual([...p.querySelectorAll('em')].map((e) => e.textContent), ['i', 'u']);
  assert.ok(p.textContent.includes('snake_case_name'), p.textContent);
  assert.ok(p.textContent.includes('e') && !p.textContent.includes('http://'), 'http link renders as its label');
  assert.ok(p.textContent.includes('[bad](has space)'), 'url with a space is not a link');
});

function must(x, label) {
  if (x == null) throw new Error(`missing ${label}`);
  return x;
}
