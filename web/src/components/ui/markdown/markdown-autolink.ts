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

/** Odd run of `\` just before index i: the character at i is escaped. */
function escaped(s: string, i: number): boolean {
    let n = 0;
    for (let j = i - 1; j >= 0 && s[j] === '\\'; j--) n++;
    return n % 2 === 1;
}

/**
 * Whether the stretch `[from, to)` of one line sits inside a link label (`[… <here> …](`). The reader
 * links no autolink there — it is label text — so load must escape its entities like any text.
 * @param s - the line (load runs per line)
 * @param from - the stretch's first index
 * @param to - the index just past it
 * @returns true when an unescaped `[` opens before it and its `](` closes after it
 */
export function insideLinkLabel(s: string, from: number, to: number): boolean {
    let open = -1;
    for (let j = from - 1; j >= 0 && open === -1; j--) {
        if (s[j] === '\n' || (s[j] === ']' && !escaped(s, j))) return false;
        if (s[j] === '[' && !escaped(s, j)) open = j;
    }
    if (open === -1) return false;
    for (let j = to; j < s.length; j++) {
        if (s[j] === '\\') { j++; continue; }
        if (s[j] === '[' || s[j] === '\n') return false;
        if (s[j] === ']') return s[j + 1] === '(';
    }
    return false;
}
