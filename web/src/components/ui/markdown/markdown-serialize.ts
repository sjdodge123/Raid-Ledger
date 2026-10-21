/**
 * Post-processing for `editor.getMarkdown()` (ROK-1868 A6 probe findings).
 *
 * `@tiptap/markdown` 3.31.4 encodes `<`, `>` and `&` typed as text as HTML
 * entities (`&lt;b&gt;`), which `MarkdownBlock` would print verbatim. Outside
 * code spans we rewrite them to subset markdown instead: `&lt;` → `\<` (an
 * escaped `<` is legal text for `findHubPostMarkdownViolation`), `&gt;` → `>`,
 * `&amp;` → `&` (or `\&` when the `&` would otherwise read as an entity).
 * Code spans are emitted verbatim by TipTap and are left untouched. Empty
 * paragraphs (and TipTap's `&nbsp;` marker for them) collapse to one blank line.
 */
const ENTITY = /&(lt|gt|amp);/g;
/**
 * A code span: an equal-length backtick run closes it (CommonMark), so ``a `b` c`` stays whole.
 * The opening run must not be backslash-escaped (an odd run of `\` before it): TipTap escapes
 * literal backticks typed as text, and those are ordinary text whose entities must be decoded
 * (Codex r4). Backslashes inside a span are literal, so the closing run needs no such check.
 */
const CODE_SPAN = /((?<!`)(?<!(?:^|[^\\])(?:\\\\)*\\)(`+)(?!`)[^\n]*?(?<!`)\2(?!`))/;
const LOOKS_LIKE_ENTITY = /^[A-Za-z#][A-Za-z0-9]*;/;
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

/** Rewrite one non-code segment. */
function decodeSegment(segment: string): string {
    return segment.replace(MARK_TAG, (_m: string, tag: string): string => (tag === 'em' ? '*' : '**')).replace(ENTITY, (_m: string, name: string, offset: number): string => {
        if (name === 'lt') return '\\<';
        if (name === 'gt') return '>';
        const rest = segment.slice(offset + 5);
        return LOOKS_LIKE_ENTITY.test(rest) ? '\\&' : '&';
    });
}

/**
 * Turn TipTap's serialised markdown into the stored subset form.
 * @param markdown - the raw `editor.getMarkdown()` output
 * @returns markdown with entity-encoded text rewritten (code spans untouched)
 *   and empty paragraphs collapsed to a single paragraph break
 */
export function normalizeEditorMarkdown(markdown: string): string {
    return collapseEmptyParagraphs(markdown)
        .split(CODE_SPAN)
        // split() with two groups yields [text, span, ticks, text, span, ticks, …].
        .flatMap((part: string, i: number): string[] => (i % 3 === 2 ? [] : [i % 3 === 1 ? part : decodeSegment(part)]))
        .join('');
}
