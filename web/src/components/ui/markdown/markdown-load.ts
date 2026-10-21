/**
 * Stored hub-post markdown → the editor's document (ROK-1868 Codex r13).
 *
 * Thirteen review rounds each found one more stored body that the editor's GFM parser grouped
 * differently from `MarkdownBlock`: a multi-paragraph list item that breaks the one-paragraph
 * `FlatListItem` schema, a quote or heading loaded as raw text (so its link and bold were lost on the
 * next save), a nested list. This module closes that class by not letting the GFM parser decide block
 * structure at all. The blocks come from `parseBlocks` — the reader's own grouping — and only each
 * LINE goes through the markdown parser, for its inline marks. A line is parsed alone (as
 * `MarkdownBlock` renders it: inline marks never span a line), with any block construct the reader
 * does not recognise escaped first (`# `, `>`, a fence, a rule, `1)`, an HTML block, a link
 * definition), so the parser sees the same literal text the reader prints and still parses its marks.
 */
import type { JSONContent } from '@tiptap/core';
import { MarkdownManager } from '@tiptap/markdown';
import { isSafeMarkdownHref } from '@raid-ledger/contract';
import { parseBlocks, type MarkdownBlockNode } from './markdown-block-parse';
import { buildMarkdownExtensions } from './markdown-extensions';
import { prepareEditorMarkdown } from './markdown-serialize';

/**
 * A line start the GFM parser reads as a block the reader does not have: ATX heading, quote, code
 * fence (a backtick run with no later backtick — otherwise it is an inline code span; a `~~~` fence
 * is already literal, `prepareEditorMarkdown` escapes every `~` of a run that is not `~~`), thematic
 * break, bullet marker, HTML block (not an `<scheme:…>` autolink), link reference definition.
 */
const BLOCK_START = /^(?:#{1,6}(?=[ \t]|$)|>|`{3,}(?=[^`]*$)|([-*_])(?:[ \t]*\1){2,}[ \t]*$|[-+*](?=[ \t]|$)|<(?![A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*>)(?=[A-Za-z/!?])|\[(?=[^\]]*\]:))/;
/** An ordered-list marker (`1.` / `1)`); the escape goes before its delimiter. */
const ORDERED_START = /^(\d{1,9})([.)])(?=[ \t]|$)/;

/**
 * Escape a line's leading block construct so it parses as the literal text `MarkdownBlock` shows.
 * @param line - one trimmed line of a block
 * @returns the line with a `\` before the construct's first character (or ordered delimiter)
 */
export function escapeBlockStart(line: string): string {
    if (ORDERED_START.test(line)) return line.replace(ORDERED_START, '$1\\$2');
    return BLOCK_START.test(line) ? `\\${line}` : line;
}

/** The reader's autolink (`parseInline`): `<http(s)://…>` up to the first `>`. */
const READER_AUTOLINK = /^<(https?:\/\/[^>]*)>/;

/** A marked link token (structural — `marked` is a dependency of `@tiptap/markdown`, not of web). */
interface LinkToken { type: 'link'; raw: string; href: string; text: string; tokens: Array<{ type: 'text'; raw: string; text: string }> }

/**
 * `<…>` as the reader reads it (Codex r14): only a safe http(s) URL links, and its href AND text are
 * the stored characters verbatim — TipTap decodes a text token's entities, so `&` goes in as `&amp;`.
 */
function readerAutolink(src: string): LinkToken | undefined {
    const href = READER_AUTOLINK.exec(src)?.[1];
    if (href === undefined || !isSafeMarkdownHref(href)) return undefined;
    const text = href.replace(/&/g, '&amp;');
    return { type: 'link', raw: `<${href}>`, href, text, tokens: [{ type: 'text', raw: text, text }] };
}

let shared: MarkdownManager | undefined;

/** One markdown manager over the editor's own extensions, for inline parsing outside an editor. */
function manager(): MarkdownManager {
    if (shared) return shared;
    shared = new MarkdownManager({
        markedOptions: { breaks: true, gfm: true },
        extensions: buildMarkdownExtensions({ onLinkShortcut: () => undefined }),
    });
    // MarkdownBlock does not autolink a bare URL, so neither does the load path (Codex r13: a stored
    // `[x]: https://…` or `!\[img\](https://…)` otherwise gains a link the reader never showed).
    shared.instance.use({ tokenizer: { url: () => undefined, autolink: readerAutolink } });
    return shared;
}

/** One line's inline content, parsed alone; literal text if it somehow parses to anything but one paragraph. */
function lineContent(line: string): JSONContent[] {
    if (line === '') return [];
    const doc = manager().parse(prepareEditorMarkdown(escapeBlockStart(line)));
    const nodes = doc.content ?? [];
    const first = nodes[0];
    if (nodes.length === 1 && first?.type === 'paragraph') return first.content ?? [];
    return [{ type: 'text', text: line }];
}

/** A block's lines as inline content, separated by hard breaks (the reader's `<br>`). */
function inline(lines: string[]): JSONContent[] {
    return lines.flatMap((line: string, i: number): JSONContent[] => [...(i > 0 ? [{ type: 'hardBreak' }] : []), ...lineContent(line)]);
}

function blockNode(block: MarkdownBlockNode): JSONContent {
    if (block.kind === 'p') return { type: 'paragraph', content: inline(block.lines) };
    const items = block.items.map((lines: string[]): JSONContent => ({ type: 'listItem', content: [{ type: 'paragraph', content: inline(lines) }] }));
    return block.kind === 'ul' ? { type: 'bulletList', content: items } : { type: 'orderedList', attrs: { start: block.start }, content: items };
}

/**
 * Build the editor document for a stored body — the same paragraphs, flat lists and line breaks
 * `MarkdownBlock` renders, each line with its inline marks.
 * @param markdown - the stored hub-post body (textarea fallback, API or backfill)
 * @returns a schema-valid TipTap document
 */
export function loadStoredMarkdown(markdown: string): JSONContent {
    const content = parseBlocks(markdown).map(blockNode);
    return { type: 'doc', content: content.length > 0 ? content : [{ type: 'paragraph' }] };
}
