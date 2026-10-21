/**
 * Post-processing for `editor.getMarkdown()` (ROK-1868 A6 probe findings).
 *
 * `@tiptap/markdown` 3.31.4 encodes `<`, `>` and `&` typed as text as HTML
 * entities (`&lt;b&gt;`), which `MarkdownBlock` would print verbatim. Outside
 * code spans we rewrite them to subset markdown instead: `&lt;` → `\<` (an
 * escaped `<` is legal text for `findHubPostMarkdownViolation`), `&gt;` → `>`,
 * `&amp;` → `&`. Entity-looking text is stored bare (`&lt;`): `MarkdownBlock`
 * prints it literally, and `prepareEditorMarkdown` escapes it on load so the
 * editor shows it literally too (Codex r7). Code spans and link destinations
 * are emitted verbatim by TipTap and are left untouched. Empty paragraphs (and
 * TipTap's `&nbsp;` marker for them) collapse to one blank line.
 */
import type { Editor } from '@tiptap/core';
import { trimUnflankedEmphasis } from './markdown-flanking';
import { fixLinkMarkBoundaries } from './markdown-link-marks';

const ENTITY = /&(lt|gt|amp);/g;
/**
 * A code span: an equal-length backtick run closes it (CommonMark), so ``a `b` c`` stays whole.
 * The opening run must not be backslash-escaped (an odd run of `\` before it): TipTap escapes
 * literal backticks typed as text, and those are ordinary text whose entities must be decoded
 * (Codex r4). Backslashes inside a span are literal, so the closing run needs no such check.
 */
const CODE_SPAN = /((?<!`)(?<!(?:^|[^\\])(?:\\\\)*\\)(`+)(?!`)[^\n]*?(?<!`)\2(?!`))/;
/** An `&` that starts an entity reference and is not already backslash-escaped. */
const ENTITY_AMP = /(?<!(?:^|[^\\])(?:\\\\)*\\)&(?=[A-Za-z#][A-Za-z0-9]*;)/g;
/**
 * TipTap's HTML reopen fallback for bold / italic across overlapping marks (`**a*b***<em>c</em>`,
 * Codex r6). Typed `<` is always entity-encoded, so a raw tag outside a code span is the fallback.
 */
const MARK_TAG = /<\/?(em|strong)>/g;
/**
 * TipTap writes the 2nd+ of consecutive empty paragraphs as a bare `&nbsp;` line (Codex r5).
 * Text typed as `&nbsp;` is serialised `&amp;nbsp;`, so a bare line is always the marker.
 */
const EMPTY_PARAGRAPH = /(^|\n)&nbsp;(?=\n|$)/g;

/** Drop empty-paragraph markers; extra blank lines collapse to one paragraph break (MarkdownBlock shows them so). */
function collapseEmptyParagraphs(markdown: string): string {
    return markdown.replace(EMPTY_PARAGRAPH, '$1').replace(/\n{3,}/g, '\n\n').replace(/^\n{2,}|\n{2,}$/g, '');
}

/** Rewrite the text of one non-code segment (never a link destination). */
function decodeText(text: string): string {
    return text.replace(MARK_TAG, (_m: string, tag: string): string => (tag === 'em' ? '*' : '**'))
        .replace(ENTITY, (_m: string, name: string): string => (name === 'lt' ? '\\<' : name === 'gt' ? '>' : '&'));
}

/** Index of the `)` closing a destination whose `(` is just before `from` (balanced, `\`-escapes skipped — as MarkdownBlock reads it), or -1. */
function closeParen(s: string, from: number): number {
    let depth = 0;
    for (let j = from; j < s.length; j++) {
        const ch = s[j];
        if (ch === '\\') j++;
        else if (ch === '(') depth++;
        else if (ch === ')' && depth-- === 0) return j;
    }
    return -1;
}

/** Split a non-code segment into [text, destination, text, …]; a destination is the `(…)` after an unescaped `]` (Codex r7). */
function splitDestinations(segment: string): string[] {
    const parts: string[] = [];
    let from = 0;
    for (let i = 0; i < segment.length; i++) {
        if (segment[i] === '\\') { i++; continue; }
        if (segment[i] !== ']' || segment[i + 1] !== '(') continue;
        const end = closeParen(segment, i + 2);
        if (end === -1) continue;
        parts.push(segment.slice(from, i + 1), segment.slice(i + 1, end + 1));
        from = end + 1;
        i = end;
    }
    parts.push(segment.slice(from));
    return parts;
}

/** Rewrite one non-code segment: text is decoded, link destinations stay byte-for-byte. */
function decodeSegment(segment: string): string {
    return splitDestinations(segment).map((part: string, i: number): string => (i % 2 === 1 ? part : decodeText(part))).join('');
}

/** Apply `rewrite` to the non-code parts only (split() with two groups yields [text, span, ticks, …]). */
function outsideCode(markdown: string, rewrite: (part: string) => string): string {
    return markdown.split(CODE_SPAN)
        .flatMap((part: string, i: number): string[] => (i % 3 === 2 ? [] : [i % 3 === 1 ? part : rewrite(part)]))
        .join('');
}

/**
 * A GFM task marker opening a list item (`- [x] a`). The editor has no task-list extension, so its
 * GFM parser would drop the marker; MarkdownBlock shows it as literal text (Codex r9).
 */
const TASK_MARKER = /^( {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+)\[([ xX])\](?=[ \t]|$)/gm;
/** The same marker as TipTap saves the literal text back (`\[x\]`); stored as typed, `[x]`. */
const ESCAPED_TASK_MARKER = /^( {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+)\\\[([ xX])\\\](?=[ \t]|$)/gm;

/**
 * An indented list marker (`  - child`). The editor's list items hold one paragraph (D14), so the
 * GFM parser's NESTED list would fail schema validation and break Enter (Codex r12); `MarkdownBlock`
 * already flattens these into the same list, so the load path drops the indent to match.
 */
const INDENTED_LIST_MARKER = /^[ \t]+((?:[-*+]|\d{1,9}[.)])[ \t]+)/gm;

/**
 * Stored markdown → what the editor's markdown parser loads (Codex r7). Stored entity text
 * (`&lt;`) is literal — `MarkdownBlock` prints it as written — but the parser would decode it,
 * so a save would rewrite `&lt;raid&gt;` to `<raid>`. Escaping the `&` keeps it literal text
 * (and keeps a destination's `&amp;` as written); code spans are literal already.
 * @param markdown - the stored hub-post body
 * @returns the same document with every unescaped entity-starting `&` written `\&`, a list
 *   item's leading task marker written `\[x]` so it loads as literal text, and nested list items
 *   un-indented into sibling items
 */
export function prepareEditorMarkdown(markdown: string): string {
    const flat = markdown.replace(INDENTED_LIST_MARKER, '$1').replace(TASK_MARKER, '$1\\[$2]');
    return outsideCode(flat, (part: string): string => part.replace(ENTITY_AMP, '\\&'));
}

/**
 * Turn TipTap's serialised markdown into the stored subset form.
 * @param markdown - the raw `editor.getMarkdown()` output
 * @returns markdown with entity-encoded text rewritten (code spans and link destinations untouched),
 *   empty paragraphs collapsed to a single paragraph break, a list item's task marker as typed, and
 *   mark delimiters at a link's edges moved inside its label (Codex r9)
 */
export function normalizeEditorMarkdown(markdown: string): string {
    const restored = collapseEmptyParagraphs(markdown).replace(ESCAPED_TASK_MARKER, '$1[$2]');
    return outsideCode(restored, (part: string): string => decodeSegment(fixLinkMarkBoundaries(part)));
}

/**
 * The editor's document as stored markdown: bold / italic / strike first give up span-edge
 * characters no delimiter can open or close beside (`markdown-flanking.ts`, Codex r10), then the
 * serialised text is normalised.
 * @param editor - the TipTap editor (with the Markdown extension)
 * @returns the stored subset markdown
 */
export function serializeEditorMarkdown(editor: Editor): string {
    const manager = editor.markdown;
    const raw = manager === undefined ? editor.getMarkdown() : manager.serialize(trimUnflankedEmphasis(editor.getJSON()));
    return normalizeEditorMarkdown(raw);
}
