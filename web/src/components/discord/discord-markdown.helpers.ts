/**
 * ROK-1483 D7 — a safe Discord-markdown tokenizer.
 *
 * This repo has NO markdown renderer and NO HTML sanitizer, and
 * `web/src/components/discord/**` is forbidden from producing raw HTML at all
 * (D15 guard). So instead of sanitizing a string down to "probably safe" HTML,
 * `tokenize` turns Discord's content into a flat `Token[]` that a React
 * component maps onto elements. React escapes every text node, so there is no
 * code path that can emit markup — the tree is XSS-proof BY CONSTRUCTION rather
 * than by a deny-list somebody has to keep patched.
 *
 * Anything the grammar below does not match stays a `text` token verbatim.
 */
import type { ThreadMessageMentionDto } from '@raid-ledger/contract';

/** The mention flavours Discord encodes in `<@id>` / `<@&id>` / `<#id>`. */
export type MentionKind = ThreadMessageMentionDto['kind'];

/**
 * One renderable span of a message. Inline emphasis carries plain `text` (no
 * nesting) on purpose: a nested grammar buys very little for chat copy and adds
 * the parser states where injection bugs live.
 */
export type Token =
    | { kind: 'text'; text: string }
    | { kind: 'bold'; text: string }
    | { kind: 'italic'; text: string }
    | { kind: 'strike'; text: string }
    | { kind: 'code'; text: string }
    | { kind: 'codeblock'; text: string; language: string | null }
    | { kind: 'quote'; children: Token[] }
    | { kind: 'link'; href: string; label: string }
    | { kind: 'mention'; mentionKind: MentionKind; id: string; display: string };

/**
 * Protocol ALLOW-list — the single rule that decides whether an anchor may be
 * built. Deliberately not a `javascript:` deny-list: a deny-list has to
 * enumerate every hostile scheme (`data:`, `vbscript:`, `blob:`, unicode
 * lookalikes) and is wrong the moment one is missed.
 *
 * @param raw candidate url straight out of user content
 * @returns true only for an absolute `http:` or `https:` url
 */
export function isHttpUrl(raw: string): boolean {
    try {
        const protocol = new URL(raw).protocol;
        return protocol === 'http:' || protocol === 'https:';
    } catch {
        return false;
    }
}

const FENCE = /```(?:([A-Za-z0-9+._-]*)\n)?([\s\S]*?)```/g;
const QUOTE_LINE = /^\s*>\s?(.*)$/;

const INLINE = new RegExp(
    [
        '`([^`\\n]+)`', // 1 inline code
        '\\*\\*([\\s\\S]+?)\\*\\*', // 2 bold
        '~~([\\s\\S]+?)~~', // 3 strike
        '\\*([^*\\n]+?)\\*', // 4 italic (asterisk)
        '_([^_\\n]+?)_', // 5 italic (underscore)
        '\\[([^\\]\\n]*)\\]\\(([^)\\s]+)\\)', // 6 label, 7 href
        '<a?:(\\w+):\\d+>', // 8 custom emoji name
        '<@!?(\\d+)>', // 9 user mention
        '<@&(\\d+)>', // 10 role mention
        '<#(\\d+)>', // 11 channel mention
        'https?://[^\\s<>()\\[\\]]+', // bare autolink (no capture)
    ].join('|'),
    'g',
);

/** Appends `text`, merging into a preceding text token so runs stay contiguous. */
function pushText(out: Token[], text: string): void {
    if (text === '') return;
    const tail = out[out.length - 1];
    if (tail && tail.kind === 'text') tail.text += text;
    else out.push({ kind: 'text', text });
}

/**
 * Resolves a mention id against the mentions frozen on the row at write time
 * (D8). An id with no entry renders as `@unknown` / `#unknown` — never as the
 * raw `<@…>`, which would leak a machine id into the transcript.
 */
function mentionToken(
    id: string,
    mentionKind: MentionKind,
    mentions: ThreadMessageMentionDto[],
): Token {
    const found = mentions.find((m) => m.id === id && m.kind === mentionKind);
    const prefix = mentionKind === 'channel' ? '#' : '@';
    return {
        kind: 'mention',
        mentionKind,
        id,
        display: `${prefix}${found ? found.displayName : 'unknown'}`,
    };
}

/** A markdown link, downgraded to plain text when its protocol is not allowed. */
function linkToken(label: string, href: string): Token {
    if (!isHttpUrl(href)) return { kind: 'text', text: `[${label}](${href})` };
    return { kind: 'link', href, label: label === '' ? href : label };
}

/** Trailing sentence punctuation is prose, not part of a bare url. */
function trimUrl(raw: string): string {
    return raw.replace(/[.,!?;:]+$/, '');
}

/** Maps one `INLINE` match onto its token. */
function inlineToken(m: RegExpExecArray, mentions: ThreadMessageMentionDto[]): Token {
    if (m[1] !== undefined) return { kind: 'code', text: m[1] };
    if (m[2] !== undefined) return { kind: 'bold', text: m[2] };
    if (m[3] !== undefined) return { kind: 'strike', text: m[3] };
    if (m[4] !== undefined) return { kind: 'italic', text: m[4] };
    if (m[5] !== undefined) return { kind: 'italic', text: m[5] };
    if (m[7] !== undefined) return linkToken(m[6] ?? '', m[7]);
    if (m[8] !== undefined) return { kind: 'text', text: `:${m[8]}:` };
    if (m[9] !== undefined) return mentionToken(m[9], 'user', mentions);
    if (m[10] !== undefined) return mentionToken(m[10], 'role', mentions);
    if (m[11] !== undefined) return mentionToken(m[11], 'channel', mentions);
    const href = trimUrl(m[0]);
    return { kind: 'link', href, label: href };
}

/** Scans one quote-free, fence-free run for inline tokens. */
function pushInline(out: Token[], input: string, mentions: ThreadMessageMentionDto[]): void {
    INLINE.lastIndex = 0;
    let cursor = 0;
    let m: RegExpExecArray | null = INLINE.exec(input);
    while (m !== null) {
        pushText(out, input.slice(cursor, m.index));
        const token = inlineToken(m, mentions);
        if (token.kind === 'text') pushText(out, token.text);
        else out.push(token);
        cursor = m.index + m[0].length;
        INLINE.lastIndex = cursor;
        m = INLINE.exec(input);
    }
    pushText(out, input.slice(cursor));
}

/** Splits a fence-free segment on line-leading `>` blockquotes. */
function pushLines(out: Token[], segment: string, mentions: ThreadMessageMentionDto[]): void {
    if (segment === '') return;
    let buffer: string[] = [];
    const flush = (): void => {
        if (buffer.length === 0) return;
        pushInline(out, buffer.join('\n'), mentions);
        buffer = [];
    };
    for (const line of segment.split('\n')) {
        const quoted = QUOTE_LINE.exec(line);
        if (!quoted) {
            buffer.push(line);
            continue;
        }
        flush();
        const children: Token[] = [];
        pushInline(children, quoted[1] ?? '', mentions);
        out.push({ kind: 'quote', children });
    }
    flush();
}

/**
 * Turns raw Discord content into renderable tokens.
 *
 * @param content verbatim `message.content` — assumed hostile
 * @param mentions mentions resolved at write time (D8); defaults to none
 * @returns a flat token list; unmatched input survives as `text`
 */
export function tokenize(content: string, mentions: ThreadMessageMentionDto[] = []): Token[] {
    const out: Token[] = [];
    let cursor = 0;
    FENCE.lastIndex = 0;
    let m: RegExpExecArray | null = FENCE.exec(content);
    while (m !== null) {
        pushLines(out, content.slice(cursor, m.index), mentions);
        out.push({ kind: 'codeblock', text: m[2] ?? '', language: m[1] || null });
        cursor = m.index + m[0].length;
        m = FENCE.exec(content);
    }
    pushLines(out, content.slice(cursor), mentions);
    return out;
}
