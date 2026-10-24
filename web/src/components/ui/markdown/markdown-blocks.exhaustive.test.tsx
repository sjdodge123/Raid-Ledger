/**
 * Codex r13 (ROK-1868) — the BLOCK-level counterpart of `markdown-roundtrip.exhaustive.test.tsx`.
 * Every block construct a stored body can hold (textarea fallback, API, backfill) — headings, quotes,
 * tight / loose / nested / multi-paragraph lists, fences, indented code, rules, setext underlines,
 * tables, HTML, link definitions, task markers, blank-line and line-break variants — each carrying
 * bold, italic, strike, code and a link, alone and between paragraphs. For each stored body:
 *   (a) the loaded document passes `doc.check()` (Enter keeps working),
 *   (b) the editor shows the same blocks, line breaks, text and marks as `MarkdownBlock`,
 *   (c) load → save → load → save is byte-stable after the first save, and the first save still
 *       renders the same as the stored body,
 *   (d) the saved markdown passes `findHubPostMarkdownViolation`.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Editor } from '@tiptap/core';
import { findHubPostMarkdownViolation } from '@raid-ledger/contract';
import { MarkdownBlock } from '../markdown-block';
import { buildMarkdownExtensions } from './markdown-extensions';
import { loadStoredMarkdown } from './markdown-load';
import { serializeEditorMarkdown } from './markdown-serialize';

const TAG_OF: Record<string, string> = { STRONG: 'b', EM: 'i', S: 's', DEL: 's', CODE: 'c', A: 'l' };
// ROK-1898: headings are blocks too — `#`–`###` render h3–h5 (MD_HEADING_TAG) in BOTH the editor and the reader.
const BLOCK_TAGS = new Set(['P', 'UL', 'OL', 'LI', 'H3', 'H4', 'H5']);
const T = '**b** *i* ~~s~~ `c` [l](https://example.com/x)';
const U = 'a **[bold link](/events)** *z*';
const editor = new Editor({ extensions: buildMarkdownExtensions({ onLinkShortcut: () => undefined }) });

afterAll(() => { editor.destroy(); });

/**
 * r14b review: an autolink is label text only inside a link the READER forms. No `)`, an unbalanced
 * `(`, a `~` in the URL, nested brackets — each must load and save like MarkdownBlock shows it.
 */
const R14C: string[] = [
    '$ [a <https://example.com/?x&amp;y> b](/p', '$ [a <https://example.com/~bob> b](/p',
    '$ [a <https://example.com/?x&amp;y> b](/p(x)', '$ [[a] <https://example.com/&amp;> b](/p)',
];

/** Block constructs; `$` is replaced by the inline text. */
const CONSTRUCTS: string[] = [
    ...R14C,
    '# $', '## $', '### $', '#### $', '##### $', '###### $', '####### $', '#$', '#', '# $ #',
    // ROK-1898: heading edge cases — two spaces IS a heading (one or more spaces); not headings: tab,
    // indent, escaped, blank text; a
    // heading whose text looks like a marker, and a heading interrupting a paragraph / hard-broken item.
    '#  $', '#\t$', ' # $', '\\## $', '# ', '## ', '# # $', '# - $', '# 1. $', '# > $', '#### $\n# $',
    '# $\n## $\n### $', '$  \n# $', '- $  \n# $', '# $  \n$', '# $\\\n$', '- # $', '1. ## $', '$  \n\\# $',
    '> $', '>$', '> > $', '> $\n> $', '> $\n$', '>\n$', '> - $', '> # $',
    '- $', '* $', '+ $', '1. $', '1) $', '3. $', '-', '- ', '1.',
    '- $\n- $', '* $\n- $', '1. $\n2. $', '1. $\n- $', '- $\n1. $',
    '- $\n\n- $', '1. $\n\n2. $', '- $\n\n\n- $',
    '- $\n  - $\n    - $', '1. $\n   1. $', '- $\n  1. $', '- $\n\t- $',
    '- $\n\n  $\n- $', '1. $\n\n   $\n2. $', '- $\n\n  $', '- $\n\n      $',
    '- $\n  $', '- $\n$', '- $  \n$', '- $\\\n$', '1. $  \n$',
    '- > $', '- # $', '- ```\n$', '- [ ] $', '- [x] $', '* [X] $', '1. [ ] $', '- [ ]',
    '```\n$\n```', '```js\n$\n```', '~~~\n$\n~~~', '```\n$', '```$```', '    $', '\t$', '$\n\n    $',
    '---', '***', '___', '* * *', '- - -', '$\n---', '$\n===', '$\n--', '$\n=', '$\n\n---\n\n$',
    '| $ | $ |\n|---|---|\n| $ | $ |', '$ | $\n--|--\n$ | $', '|---|',
    '<div>$</div>', '<!-- c -->\n$', '<b>$</b>', '<https://example.com> $', '<br>\n$',
    '[x]: https://example.com\n$', '[x]: https://example.com', '[[x]: y](/p) $', '![img](https://example.com/i.png) $',
    '$\n$', '$\n\n$', '$\n\n\n\n$', '\n\n$\n\n', '$  \n$', '$\\\n$', '$\r\n$', '$\r\n\r\n$', '  $  ',
    '&lt;$&gt;', '\\# $', '\\- $', '1\\. $', '\\> $', '\\* $', '\\+ $', '- \\- $', '$ https://example.com $',
    // Codex r14: an autolink's destination is verbatim (no escapes, no entities); only `~~` strikes.
    '<https://example.com?x=1&amp;y=2> $', '$ <https://example.com/a&lt;b&#38;c> $', '- <https://example.com/?q=&amp;> $',
    '$ ~20:00~ $', '~x~ $', '$ ~~~x~~~ $', '$ ~ ~~ ~~~ $', '\\~~x~~ $', '~~x~ $', '- ~a~ $',
    '``` `c` $', '$ ``` `c` ``` $',
    // An unsafe `<https…` (a space before its `>`) is text and must not swallow a code span's protection;
    // an autolink inside a link label is label text to the reader, so its `&amp;` stays literal.
    '$ <https://x.com now, run `a~b &amp; c` if 2 > 1', '<https://x.com y `a~b&amp;c`> $',
    '[<https://example.com/?a&amp;b>](/p) $', '$ [x <https://example.com/~a~&amp;> y](/p)',
];

/** Each construct alone, after a paragraph line, before one, and between blank-line paragraphs. */
function inputs(): string[] {
    const out: string[] = [];
    for (const text of [T, U]) {
        for (const c of CONSTRUCTS) {
            const body = c.split('$').join(text);
            out.push(body, `${text}\n${body}`, `${body}\n${text}`, `${text}\n\n${body}\n\n${text}`);
        }
    }
    return [...new Set(out)];
}

/** Block / break / text-with-marks signature of rendered HTML; whitespace ignored, a list item's `<p>` is the item. */
function signature(html: string): string {
    const root = document.createElement('div');
    root.innerHTML = html;
    const out: string[] = [];
    const walk = (node: Node, marks: string): void => {
        if (node.nodeType === Node.TEXT_NODE) {
            for (const ch of node.textContent ?? '') if (ch.trim() !== '') out.push(`${ch}:${[...marks].sort().join('')}`);
            return;
        }
        if (!(node instanceof Element)) return;
        if (node.tagName === 'BR') { out.push('⏎'); return; }
        if (node.tagName === 'A') out.push(`href=${node.getAttribute('href') ?? ''}`);
        const block = BLOCK_TAGS.has(node.tagName) && !(node.tagName === 'P' && node.parentElement?.tagName === 'LI');
        if (block) out.push(`<${node.tagName}>`);
        for (const child of node.childNodes) walk(child, marks + (TAG_OF[node.tagName] ?? ''));
        if (block) out.push(`</${node.tagName}>`);
    };
    walk(root, '');
    return out.join(' ');
}

const shown = (markdown: string): string => signature(renderToStaticMarkup(<MarkdownBlock text={markdown} />));

/** Load a stored body the way `MarkdownEditor` does; the schema error, if the document is invalid. */
function load(markdown: string): string | null {
    const json = loadStoredMarkdown(markdown);
    try {
        editor.schema.nodeFromJSON(json).check();
        editor.commands.setContent(json, { emitUpdate: false });
        editor.state.doc.check();
        return null;
    } catch (error: unknown) {
        return error instanceof Error ? error.message : String(error);
    }
}

/** One stored body; a message naming every check it breaks, or null. */
function blockFailure(input: string): string | null {
    const errors: string[] = [];
    const schemaError = load(input);
    if (schemaError !== null) errors.push(`(a) ${schemaError}`);
    const want = shown(input);
    const inEditor = signature(editor.getHTML());
    if (inEditor !== want) errors.push(`(b) editor ${inEditor} ≠ reader ${want}`);
    const saved = serializeEditorMarkdown(editor);
    if (shown(saved) !== want) errors.push(`(c) saved ${JSON.stringify(saved)} renders ${shown(saved)}`);
    const violation = findHubPostMarkdownViolation(saved);
    if (violation !== null) errors.push(`(d) ${violation}`);
    load(saved);
    const resaved = serializeEditorMarkdown(editor);
    if (resaved !== saved) errors.push(`(c) resaved ${JSON.stringify(resaved)} ≠ ${JSON.stringify(saved)}`);
    return errors.length === 0 ? null : `${JSON.stringify(input)}: ${errors.join('; ')}`;
}

describe('every stored block construct loads, shows and saves like MarkdownBlock (Codex r13)', () => {
    it('block construct × context × inline text', () => {
        const cases = inputs();
        const bad = cases.map(blockFailure).filter((m): m is string => m !== null);
        expect(bad.slice(0, 10), `${bad.length} of ${cases.length} cases failed`).toEqual([]);
    });

    it.each(R14C)('r14c review repro %s', (construct: string) => {
        expect(blockFailure(construct.split('$').join(T))).toBeNull();
    });

    it('the two Codex r13 bodies: a two-paragraph item stays schema-valid, a quoted link survives an edit', () => {
        expect(load('- first\n\n  another paragraph\n- last')).toBeNull();
        expect(editor.commands.enter()).toBe(true);
        load('> Read [the plan](/events)');
        editor.commands.insertContentAt(1, '!');
        const saved = serializeEditorMarkdown(editor);
        expect(shown(saved)).toBe(shown('!> Read [the plan](/events)'));
    });
});
