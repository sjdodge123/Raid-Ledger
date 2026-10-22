/**
 * Mark delimiters at a link's edges (ROK-1868, Codex r9).
 *
 * TipTap keeps a mark open across a link: plain `a`, then bold `b` (a link)
 * and bold `c` serialise as `a**[b](https://x)c**`. That opening `**` sits
 * between a word character and `[`, so it is not left-flanking and
 * `MarkdownBlock` (CommonMark rules) prints it literally. The mirror case is a
 * closer after `)` followed by a word character (`**a[b](https://x)**c`).
 *
 * A line holding a link is read into characters with their marks (bold,
 * italic, strike), then written back so that every delimiter at a link edge
 * can open or close: a mark stays outside the link only when it covers the
 * character before, the whole label and the character after (or the line
 * edge); any other mark is closed before `[`, written inside the label, and
 * reopened after `)`. `a[**b**](https://x)**c**` carries the same marks on
 * every character. A line that does not read cleanly is returned unchanged.
 */
type Mark = '**' | '*' | '~~';
interface TextAtom { kind: 'text'; s: string; marks: Mark[] }
interface LinkAtom { kind: 'link'; label: TextAtom[]; dest: string }
type Atom = TextAtom | LinkAtom;

const ALL: Mark[] = ['**', '*', '~~'];
const TAG = /^<(\/?)(em|strong)>/;

/** Open (or close) `m`; false when the stack is already in that state. */
function toggle(stack: Mark[], m: Mark, open: boolean): boolean {
    const at = stack.indexOf(m);
    if (open === (at !== -1)) return false;
    if (open) stack.push(m);
    else stack.splice(at, 1);
    return true;
}

/** Apply a run of `k` stars as TipTap writes them: closers first, then openers. */
function applyStars(k: number, stack: Mark[]): boolean {
    let left = k;
    const bold = stack.includes('**');
    const italic = stack.includes('*');
    if (bold && italic && left >= 3) { toggle(stack, '**', false); toggle(stack, '*', false); left -= 3; }
    else if (bold && left >= 2) { toggle(stack, '**', false); left -= 2; }
    else if (italic && left % 2 === 1) { toggle(stack, '*', false); left -= 1; }
    if (left === 0) return true;
    if (left === 1) return toggle(stack, '*', true);
    if (left === 2) return toggle(stack, '**', true);
    return left === 3 && toggle(stack, '**', true) && toggle(stack, '*', true);
}

/** Apply a run of `k` tildes (pairs toggle strike). */
function applyTildes(k: number, stack: Mark[]): boolean {
    if (k % 2 === 1) return false;
    for (let n = 0; n < k; n += 2) toggle(stack, '~~', !stack.includes('~~'));
    return true;
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

const isText = (a: Atom): a is TextAtom => a.kind === 'text';

/** A link at `i` (its `[`), its label read with the marks open so far; undefined when `i` starts none, null on a bad read. */
function readLink(s: string, i: number, stack: Mark[]): { atom: LinkAtom; next: number } | null | undefined {
    const rb = closeBracket(s, i);
    const end = rb === -1 ? -1 : linkEnd(s, rb);
    if (end === -1) return undefined;
    const label = readInline(s.slice(i + 1, rb), stack, false);
    if (label === null) return null;
    return { atom: { kind: 'link', label: label.filter(isText), dest: s.slice(rb + 1, end) }, next: end };
}

/** Read `s` into marked characters (and links when `links`); null when a delimiter does not fit. */
function readInline(s: string, stack: Mark[], links: boolean): Atom[] | null {
    const out: Atom[] = [];
    for (let i = 0; i < s.length;) {
        const ch = s[i] ?? '';
        let j = i;
        while (s[j] === ch && (ch === '*' || ch === '~')) j++;
        if (j > i) {
            if (!(ch === '*' ? applyStars(j - i, stack) : applyTildes(j - i, stack))) return null;
            i = j;
            continue;
        }
        const tag = ch === '<' ? TAG.exec(s.slice(i)) : null;
        if (tag) {
            if (!toggle(stack, tag[2] === 'em' ? '*' : '**', tag[1] === '')) return null;
            i += tag[0].length;
            continue;
        }
        const link = links && ch === '[' ? readLink(s, i, stack) : undefined;
        if (link === null) return null;
        if (link !== undefined) { out.push(link.atom); i = link.next; continue; }
        const len = ch === '\\' ? 2 : 1;
        out.push({ kind: 'text', s: s.slice(i, i + len), marks: [...stack] });
        i += len;
    }
    return out;
}

const isStar = (m: Mark | undefined): boolean => m === '*' || m === '**';

/**
 * Delimiters that turn the open `stack` into `want`. Closers go in reverse open order, except
 * that `*` and `**` may close out of order (CommonMark matches `***a**b*`), so no `****` run
 * appears; any other mark above a closer is closed and reopened.
 */
function transition(stack: Mark[], want: Mark[]): string {
    const toClose = new Set(stack.filter((m: Mark): boolean => !want.includes(m)));
    const reopen: Mark[] = [];
    let out = '';
    while (toClose.size > 0) {
        const top = stack.at(-1);
        const below = stack.at(-2);
        if (top === undefined) break;
        if (toClose.has(top)) { stack.pop(); toClose.delete(top); out += top; }
        else if (isStar(top) && below !== undefined && isStar(below) && toClose.has(below)) { stack.splice(-2, 1); toClose.delete(below); out += below; }
        else { stack.pop(); reopen.unshift(top); out += top; }
    }
    for (const m of [...reopen, ...want]) if (!stack.includes(m)) { stack.push(m); out += m; }
    return out;
}

/** Write one link: marks that span it stay outside, the rest live inside the label. */
function writeLink(link: LinkAtom, stack: Mark[], prev: Mark[], next: Mark[]): string {
    const span = ALL.filter((m: Mark): boolean => prev.includes(m) && next.includes(m)
        && link.label.every((t: TextAtom): boolean => t.marks.includes(m)));
    let out = `${transition(stack, stack.filter((m: Mark): boolean => span.includes(m)).concat(span.filter((m: Mark): boolean => !stack.includes(m))))}[`;
    const inner: Mark[] = [];
    for (const t of link.label) out += transition(inner, t.marks.filter((m: Mark): boolean => !span.includes(m))) + t.s;
    return `${out}${transition(inner, [])}]${link.dest}`;
}

/** Write a read line back with link-safe delimiters. */
function writeLine(atoms: Atom[]): string {
    const stack: Mark[] = [];
    let out = '';
    atoms.forEach((a: Atom, idx: number): void => {
        if (a.kind === 'text') { out += transition(stack, a.marks) + a.s; return; }
        const after = atoms[idx + 1];
        const next = after === undefined ? ALL : after.kind === 'text' ? after.marks : [];
        out += writeLink(a, stack, idx === 0 ? ALL : [...stack], next);
    });
    return out + transition(stack, []);
}

/** One line: rewritten when it holds a link and reads cleanly, else unchanged. */
function fixLine(line: string): string {
    if (!line.includes('](')) return line;
    const stack: Mark[] = [];
    const atoms = readInline(line, stack, true);
    if (atoms === null || stack.length > 0 || !atoms.some((a: Atom): boolean => a.kind === 'link')) return line;
    return writeLine(atoms);
}

/**
 * Rewrite mark delimiters around links so `MarkdownBlock` renders the marks the editor holds.
 * Runs on TipTap's raw output (its `<em>` / `<strong>` reopen fallback included) before entity
 * decoding. A line without a link, or one that does not read cleanly, is returned unchanged.
 * @param segment - one non-code segment of serialised markdown
 * @returns the segment with link-edge delimiters placed where they can open and close
 */
export function fixLinkMarkBoundaries(segment: string): string {
    return segment.split('\n').map(fixLine).join('\n');
}
