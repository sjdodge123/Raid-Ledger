/**
 * Post-processing for `editor.getMarkdown()` (ROK-1868 A6 probe findings).
 *
 * `@tiptap/markdown` 3.31.4 encodes `<`, `>` and `&` typed as text as HTML
 * entities (`&lt;b&gt;`), which `MarkdownBlock` would print verbatim. Outside
 * code spans we rewrite them to subset markdown instead: `&lt;` → `\<` (an
 * escaped `<` is legal text for `findHubPostMarkdownViolation`), `&gt;` → `>`,
 * `&amp;` → `&` (or `\&` when the `&` would otherwise read as an entity).
 * Code spans are emitted verbatim by TipTap and are left untouched.
 */
const ENTITY = /&(lt|gt|amp);/g;
/** A code span: an equal-length backtick run closes it (CommonMark), so ``a `b` c`` stays whole. */
const CODE_SPAN = /((?<!`)(`+)(?!`)[^\n]*?(?<!`)\2(?!`))/;
const LOOKS_LIKE_ENTITY = /^[A-Za-z#][A-Za-z0-9]*;/;

/** Rewrite one non-code segment. */
function decodeSegment(segment: string): string {
    return segment.replace(ENTITY, (_m: string, name: string, offset: number): string => {
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
 */
export function normalizeEditorMarkdown(markdown: string): string {
    return markdown
        .split(CODE_SPAN)
        // split() with two groups yields [text, span, ticks, text, span, ticks, …].
        .flatMap((part: string, i: number): string[] => (i % 3 === 2 ? [] : [i % 3 === 1 ? part : decodeSegment(part)]))
        .join('');
}
