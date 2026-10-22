/**
 * Block grouping for `MarkdownBlock` (ROK-1868 D14). Pure: source in, blocks
 * out. A blank line ends a block; consecutive `- ` / `* ` / `+ ` lines form a
 * bullet list and `N. ` lines a numbered list (one level — indented markers
 * flatten into the same list); an indented non-marker line, or any non-marker
 * line after a hard-break line (trailing two spaces / `\`), continues the
 * previous item (rendered after a `<br>`); everything else is a paragraph
 * whose single newlines are `<br>`s. Headings, quotes, rules, tables and HTML
 * are NOT recognised — they are paragraph text, rendered literally.
 */

/** One rendered block; every `lines` entry is one line of inline Markdown. */
export type MarkdownBlockNode =
    | { kind: 'p'; lines: string[] }
    | { kind: 'ul'; items: string[][] }
    | { kind: 'ol'; start: number; items: string[][] };

type ListKind = 'ul' | 'ol';

interface ListLine {
    kind: ListKind;
    start: number;
    text: string;
}

const BULLET = /^\s*[-*+][ \t]+(.*)$/;
const ORDERED = /^\s*(\d{1,9})\.[ \t]+(.*)$/;

/** A list-item line's kind, number and content, or null. */
function listLine(line: string): ListLine | null {
    const bullet = BULLET.exec(line);
    if (bullet) return { kind: 'ul', start: 1, text: bullet[1] ?? '' };
    const ordered = ORDERED.exec(line);
    if (ordered) return { kind: 'ol', start: Number(ordered[1]), text: ordered[2] ?? '' };
    return null;
}

/** Drop a CommonMark hard-break marker (trailing spaces or `\`) — the newline already breaks. */
function stripBreakMarker(line: string): string {
    const trimmed = line.trim();
    return trimmed.endsWith('\\') && !trimmed.endsWith('\\\\') ? trimmed.slice(0, -1) : trimmed;
}

/** True when `line` ends in a CommonMark hard break: two+ trailing spaces, or one unescaped `\`. */
function endsWithHardBreak(line: string): boolean {
    if (/ {2,}$/.test(line)) return true;
    const trimmed = line.trimEnd();
    return trimmed.endsWith('\\') && !trimmed.endsWith('\\\\');
}

function newList(item: ListLine): MarkdownBlockNode {
    return item.kind === 'ul'
        ? { kind: 'ul', items: [[item.text]] }
        : { kind: 'ol', start: item.start, items: [[item.text]] };
}

/** Add `raw` to the open block when it belongs there; false means "start a new block". */
function extend(cur: MarkdownBlockNode | null, raw: string, item: ListLine | null): boolean {
    if (!cur) return false;
    if (item) {
        if (cur.kind !== item.kind) return false;
        cur.items.push([item.text]);
        return true;
    }
    if (cur.kind === 'p') {
        cur.lines.push(raw);
        return true;
    }
    const last = cur.items[cur.items.length - 1];
    if (!last) return false;
    // Indented, or the item's previous line ends in a hard break — TipTap serialises a
    // break inside a list item with NO continuation indent (`1. one  \ncontinued`).
    if (!/^\s/.test(raw) && !endsWithHardBreak(last[last.length - 1] ?? '')) return false;
    last.push(raw);
    return true;
}

/** Tidy a block's lines once it is complete: hard-break markers off every non-final line. */
function finish(block: MarkdownBlockNode): MarkdownBlockNode {
    const tidy = (lines: string[]): string[] =>
        lines.map((l, i) => (i < lines.length - 1 ? stripBreakMarker(l) : l.trim()));
    return block.kind === 'p' ? { kind: 'p', lines: tidy(block.lines) } : { ...block, items: block.items.map(tidy) };
}

/** Group Markdown source into paragraphs and flat lists (see the file header). */
export function parseBlocks(text: string): MarkdownBlockNode[] {
    const blocks: MarkdownBlockNode[] = [];
    let cur: MarkdownBlockNode | null = null;
    for (const raw of text.split(/\r?\n/)) {
        if (raw.trim() === '') {
            cur = null;
            continue;
        }
        const item = listLine(raw);
        if (extend(cur, raw, item)) continue;
        cur = item ? newList(item) : { kind: 'p', lines: [raw] };
        blocks.push(cur);
    }
    return blocks.map(finish);
}
