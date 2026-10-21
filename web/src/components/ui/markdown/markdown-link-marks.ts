/**
 * Mark delimiters at a link's edges (ROK-1868, Codex r9).
 *
 * TipTap keeps a mark open across a link: bold `b` (a link) + bold `c` after
 * plain `a` serialises as `a**[b](https://x)c**`. That opening `**` sits
 * between a word character and `[` — not left-flanking — so `MarkdownBlock`
 * (CommonMark rules) prints it literally. The mirror case is a closer after
 * `)` followed by a word character (`**a[b](https://x)**c`).
 *
 * The fix moves such delimiters inside the link label: `a[**b**](https://x)**c**`
 * and `**a**[**b**](https://x)c` carry the same marks on every character, and
 * every delimiter now has punctuation (`[`, `]`, `(`, `)`) on its open side.
 * A small stack of open delimiters (`**`, `*`, `~~`) splits a run into the
 * marks it closes and the marks it opens, as TipTap writes them (closers first).
 */
type Stack = string[];

const isWord = (ch: string | undefined): boolean =>
    ch !== undefined && ch.trim() !== '' && !/[\p{P}\p{S}]/u.test(ch);

/** End (exclusive) of the delimiter run of `*` / `~` starting at i. */
function runEnd(s: string, i: number): number {
    let j = i;
    while (s[j] === '*' || s[j] === '~') j++;
    return j;
}

/** Split `run` into the tokens it closes (popped from `stack`) and the tokens it opens (pushed). */
function splitRun(run: string, stack: Stack): { closers: string[]; openers: string[] } {
    const closers: string[] = [];
    let k = 0;
    for (let top = stack.at(-1); top !== undefined && run.startsWith(top, k); top = stack.at(-1)) {
        closers.push(top);
        k += top.length;
        stack.pop();
    }
    const openers: string[] = [];
    while (k < run.length) {
        const tok = run.startsWith('~~', k) ? '~~' : run.startsWith('**', k) ? '**' : run.slice(k, k + 1);
        openers.push(tok);
        k += tok.length;
    }
    stack.push(...openers);
    return { closers, openers };
}

/** Index of the `]` matching the `[` at i (escapes skipped), or -1. */
function closeBracket(s: string, i: number): number {
    let depth = 0;
    for (let j = i; j < s.length; j++) {
        if (s[j] === '\\') j++;
        else if (s[j] === '[') depth++;
        else if (s[j] === ']' && --depth === 0) return j;
    }
    return -1;
}

/** Index just past the `)` of a `[label](dest)` whose `]` is at `rb`, or -1. */
function linkEnd(s: string, rb: number): number {
    if (s[rb + 1] !== '(') return -1;
    let depth = 0;
    for (let j = rb + 2; j < s.length; j++) {
        if (s[j] === '\\') j++;
        else if (s[j] === '(') depth++;
        else if (s[j] === ')' && depth-- === 0) return j + 1;
    }
    return -1;
}

const closeAll = (toks: string[]): string => [...toks].reverse().join('');

/** One link at `lb` (its `[`), given the run just before it already split into `before`. */
function rewriteLink(s: string, lb: number, rb: number, end: number, before: { closers: string[]; openers: string[] }, prevCh: string | undefined, stack: Stack): { out: string; next: number } {
    const moveOpen = isWord(prevCh) ? before.openers : [];
    const rEnd = runEnd(s, end);
    const after = splitRun(s.slice(end, rEnd), [...stack]);
    // Closers after `)` that close marks opened before the link, when a word character follows.
    const pending = moveOpen.length;
    const shut = after.closers.slice(Math.min(pending, after.closers.length));
    const moveClose = isWord(s[rEnd]) && pending <= after.closers.length ? shut : [];
    const keptOpen = before.openers.slice(0, before.openers.length - moveOpen.length);
    const outside = [...moveClose];
    while (outside.length > 0 && keptOpen.at(-1) === outside[0]) { keptOpen.pop(); outside.shift(); }
    let out = before.closers.join('') + keptOpen.join('') + outside.join('');
    const inner = [...[...moveClose].reverse(), ...moveOpen];
    out += `[${inner.join('')}${fixLinkMarkBoundaries(s.slice(lb + 1, rb))}${closeAll(inner)}${s.slice(rb, end)}`;
    // Reopen moved openers that the run after `)` does not close; drop the closers we moved.
    const closedOpen = Math.min(pending, after.closers.length);
    const reopen = moveOpen.slice(0, pending - closedOpen);
    const restClosers = after.closers.slice(closedOpen, after.closers.length - moveClose.length);
    out += reopen.join('') + restClosers.join('') + after.openers.join('');
    stack.splice(stack.length - after.closers.length, after.closers.length, ...after.openers);
    return { out, next: rEnd };
}

/**
 * Rewrite delimiters that cannot open / close at a link edge so `MarkdownBlock` renders the marks
 * the editor holds. Text without such a boundary is returned unchanged.
 * @param s - one non-code segment of serialised markdown
 * @returns the segment with edge delimiters moved inside the link labels
 */
export function fixLinkMarkBoundaries(s: string): string {
    if (!s.includes('](')) return s;
    const stack: Stack = [];
    let out = '';
    for (let i = 0; i < s.length;) {
        const ch = s[i];
        if (ch === '\\') { out += s.slice(i, i + 2); i += 2; continue; }
        const isRun = ch === '*' || ch === '~';
        const j = isRun ? runEnd(s, i) : i;
        const rb = s[j] === '[' ? closeBracket(s, j) : -1;
        const end = rb === -1 ? -1 : linkEnd(s, rb);
        if (end !== -1) {
            const before = splitRun(s.slice(i, j), stack);
            const r = rewriteLink(s, j, rb, end, before, s[i - 1], stack);
            out += r.out;
            i = r.next;
            continue;
        }
        if (isRun) splitRun(s.slice(i, j), stack);
        out += s.slice(i, Math.max(j, i + 1));
        i = Math.max(j, i + 1);
    }
    return out;
}
