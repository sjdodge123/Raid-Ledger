/**
 * The one `<https://…>` autolink grammar (ROK-1868 r14 review) shared by the reader (`parseInline`),
 * the editor's load tokenizer (`markdown-load.ts`) and the verbatim stretches of load / save
 * (`markdown-serialize.ts`). As in CommonMark, the body holds no space, control char, `<` or `>` —
 * exactly the characters `isSafeMarkdownHref` rejects plus the delimiters — so every match is a safe
 * link and `<https://x.com and more > 1` is plain text that can never swallow a code span.
 */

/** The autolink as a regex source: group 1 is the href. */
export const AUTOLINK_SOURCE = String.raw`<(https?:\/\/[^\x00-\x20\x7f-\x9f<>]*)>`;

const AUTOLINK_AT = new RegExp(AUTOLINK_SOURCE, 'y');

/**
 * The autolink starting at index `i` of `s`, if one does.
 * @param s - the text being read
 * @param i - the index of a `<`
 * @returns the href and the index just past the closing `>`, or null
 */
export function autolinkAt(s: string, i: number): { href: string; end: number } | null {
    AUTOLINK_AT.lastIndex = i;
    const match = AUTOLINK_AT.exec(s);
    const href = match?.[1];
    return match === null || href === undefined ? null : { href, end: i + match[0].length };
}
