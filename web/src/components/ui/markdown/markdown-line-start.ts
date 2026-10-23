/**
 * Save-side guard for text that starts a line (ROK-1868 Codex r13 block harness).
 *
 * TipTap writes paragraph text verbatim at a line start, so text reading `- raid` or `1. raid`
 * (loaded from a stored `\- raid`, or typed after a line break) is saved as `- raid` — and
 * `MarkdownBlock` then shows a LIST. Before serialising, such a line start gets a private-use
 * sentinel in front of its marker (bullet) or delimiter (ordered); after serialising the sentinel
 * becomes `\`, so the stored line is `\- raid` / `1\. raid` and reads back as the same text.
 * (`*` needs no guard: TipTap escapes it itself.) ROK-1898: a `#`–`###` + space line start gets
 * the sentinel before its `#` (stored `\# raid`), or it would read back as a heading. Code-marked text is left alone.
 */
import type { JSONContent } from '@tiptap/core';

export const LINE_START_SENTINEL = '';

const ORDERED = /^([ \t]*\d{1,9})(?=\.(?:[ \t]|$))/;
const BULLET = /^([ \t]*)(?=[-+](?:[ \t]|$))/;
/** `#`–`###` + space at column 0 reads back as a heading (ROK-1898); TipTap never escapes `#`. */
const HEADING = /^(?=#{1,3} )/;

function guardText(text: string): string {
    if (ORDERED.test(text)) return text.replace(ORDERED, `$1${LINE_START_SENTINEL}`);
    if (HEADING.test(text)) return `${LINE_START_SENTINEL}${text}`;
    return text.replace(BULLET, `$1${LINE_START_SENTINEL}`);
}

function guardInline(content: JSONContent[]): JSONContent[] {
    let lineStart = true;
    return content.map((node: JSONContent): JSONContent => {
        if (node.type === 'hardBreak') { lineStart = true; return node; }
        const atStart = lineStart;
        lineStart = false;
        const isCode = (node.marks ?? []).some((m) => m.type === 'code');
        if (!atStart || node.type !== 'text' || node.text === undefined || isCode) return node;
        return { ...node, text: guardText(node.text) };
    });
}

/**
 * Mark every list-marker-looking line start in the document's paragraphs.
 * @param doc - the editor JSON about to be serialised
 * @returns a copy whose line-start `-` / `+` / `N.` text carries the sentinel
 */
export function guardLineStarts(doc: JSONContent): JSONContent {
    const content = doc.content;
    if (content === undefined) return doc;
    if (doc.type === 'paragraph') return { ...doc, content: guardInline(content) };
    return { ...doc, content: content.map(guardLineStarts) };
}
