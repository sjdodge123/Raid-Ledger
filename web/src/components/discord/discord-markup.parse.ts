/**
 * ROK-1878 — Discord's inline markup as a node tree, for embeds and message
 * content on the hub's Discord mirror.
 *
 * Discord's dialect, not the hub-post one: `__x__` is UNDERLINE, `\x` escapes,
 * `<t:UNIX:STYLE>` is a timestamp, and `<@id>` / `<@&id>` / `<#id>` /
 * `<:name:id>` are mentions and emoji. Emphasis nests (`**a __b__**`).
 *
 * The output is data, never HTML: `DiscordMarkup` maps it onto React elements,
 * so raw markup in the source can only ever become an escaped text node. A
 * link exists only when its href passes the contract's `isSafeMarkdownHref`;
 * no node ever carries a raw snowflake id.
 */
import { isSafeMarkdownHref, type ThreadMessageMentionDto } from '@raid-ledger/contract';
import { discordTimestampDate, toTimestampStyle, type DiscordTimestampStyle } from './discord-markup-time';

/** One rendered span of Discord markup. */
export type DiscordNode =
    | { kind: 'text'; text: string }
    | { kind: 'strong' | 'em' | 'u' | 's'; children: DiscordNode[] }
    | { kind: 'code'; text: string }
    | { kind: 'link'; href: string; children: DiscordNode[] }
    | { kind: 'mention'; display: string }
    | { kind: 'time'; unix: number; style: DiscordTimestampStyle; raw: string };

/** A channel the caller can name (e.g. the mirror's own bound channel). */
export interface DiscordChannelName { id: string; name: string }

/** What a mention can be resolved against; anything unresolved gets a neutral label. */
export interface DiscordMarkupContext {
    mentions: ThreadMessageMentionDto[];
    channels: DiscordChannelName[];
}

/** Nesting cap — deeper emphasis stays literal text instead of recursing further. */
const MAX_DEPTH = 6;

/*
 * Units of an emphasis body. An escape or a code span is consumed whole, so a
 * delimiter inside one can never close the emphasis around it; a lone `\` or
 * an unpaired backtick is only taken when it cannot start either.
 */
const ESCAPE_UNIT = '\\\\[^A-Za-z0-9\\s]|\\\\(?![^A-Za-z0-9\\s])';
const CODE_UNIT = '```[\\s\\S]+?```|`[^`]+`|`(?![^`]*`)';
const BODY = `(?:${ESCAPE_UNIT}|${CODE_UNIT}|[^\\\\\`])+?`;
/** Asterisk italic: one line, no bare `*`, but a whole `**bold**` may nest. */
const ITALIC_BODY = `(?:\\*\\*${BODY}\\*\\*|${ESCAPE_UNIT}|${CODE_UNIT}|[^*\\n\\\\\`])+?`;

const INLINE_SOURCE = [
    '\\\\([^A-Za-z0-9\\s])', // 1 escaped character
    '```([\\s\\S]+?)```', // 2 fenced code, shown inline
    '`([^`]+)`', // 3 inline code
    `\\*\\*\\*(${BODY})\\*\\*\\*`, // 4 bold italic
    `___(${BODY})___`, // 5 underline italic
    `\\*\\*(${BODY})\\*\\*`, // 6 bold
    `__(${BODY})__`, // 7 underline
    `~~(${BODY})~~`, // 8 strike
    `\\*(${ITALIC_BODY})\\*(?!\\*)`, // 9 italic (asterisk)
    '(?<![A-Za-z0-9])_([^_\\n]+?)_(?![A-Za-z0-9])', // 10 italic (underscore, word-bounded)
    '\\[([^\\]\\n]+)\\]\\(<?([^)\\s>]+)>?\\)', // 11 label, 12 href
    '<t:(-?\\d+)(?::([A-Za-z]))?>', // 13 unix seconds, 14 style
    '<a?:(\\w+):\\d+>', // 15 custom emoji name
    '<@!?(\\d+)>', // 16 user
    '<@&(\\d+)>', // 17 role
    '<#(\\d+)>', // 18 channel
    '<(https?://[^\\s>]+)>', // 19 embed-suppressed url
    'https?://[^\\s<>()\\[\\]]+', // bare url (no capture)
].join('|');

/** Recursion state: `links` is false inside a link label, so no anchor nests in another. */
interface ParseState {
    ctx: DiscordMarkupContext;
    depth: number;
    links: boolean;
}

/** Appends text, merging into a preceding text node. */
function pushText(out: DiscordNode[], text: string): void {
    if (text === '') return;
    const tail = out[out.length - 1];
    if (tail?.kind === 'text') tail.text += text;
    else out.push({ kind: 'text', text });
}

function mentionNode(prefix: '@' | '#', name: string | undefined, fallback: string): DiscordNode {
    return { kind: 'mention', display: `${prefix}${name ?? fallback}` };
}

function findMention(ctx: DiscordMarkupContext, id: string, kind: ThreadMessageMentionDto['kind']): string | undefined {
    return ctx.mentions.find((m) => m.id === id && m.kind === kind)?.displayName;
}

function channelNode(id: string, ctx: DiscordMarkupContext): DiscordNode {
    const name = findMention(ctx, id, 'channel') ?? ctx.channels.find((c) => c.id === id)?.name;
    return mentionNode('#', name, 'channel');
}

function timeNode(m: RegExpExecArray): DiscordNode {
    const unix = Number(m[13]);
    const style = toTimestampStyle(m[14]);
    if (style === null || discordTimestampDate(unix) === null) return { kind: 'text', text: m[0] };
    return { kind: 'time', unix, style, raw: m[0] };
}

function urlNode(raw: string, st: ParseState): DiscordNode[] {
    if (!st.links) return [{ kind: 'text', text: raw }];
    const href = raw.replace(/[.,!?;:]+$/, '');
    const tail: DiscordNode[] = href === raw ? [] : [{ kind: 'text', text: raw.slice(href.length) }];
    if (!isSafeMarkdownHref(href)) return [{ kind: 'text', text: raw }];
    return [{ kind: 'link', href, children: [{ kind: 'text', text: href }] }, ...tail];
}

function child(st: ParseState, links: boolean = st.links): ParseState {
    return { ctx: st.ctx, depth: st.depth + 1, links };
}

/** A `[label](href)`; the label is parsed with links off. Inside a label the whole thing is text. */
function linkNode(m: RegExpExecArray, st: ParseState): DiscordNode {
    const href = m[12] ?? '';
    if (!st.links || !isSafeMarkdownHref(href)) return { kind: 'text', text: m[0] };
    return { kind: 'link', href, children: parseAt(m[11] ?? '', child(st, false)) };
}

function emphasis(kind: 'strong' | 'em' | 'u' | 's', inner: string, st: ParseState): DiscordNode {
    return { kind, children: parseAt(inner, child(st)) };
}

/** `***x***` / `___x___` — the outer style wrapping an italic. */
function tripleNode(kind: 'strong' | 'u', inner: string, st: ParseState): DiscordNode {
    return { kind, children: [emphasis('em', inner, child(st))] };
}

/** Maps an emphasis or code match onto its node, or null when the match is something else. */
function styleNode(m: RegExpExecArray, st: ParseState): DiscordNode | null {
    if (m[1] !== undefined) return { kind: 'text', text: m[1] };
    const code = m[2] ?? m[3];
    if (code !== undefined) return { kind: 'code', text: code };
    if (m[4] !== undefined) return tripleNode('strong', m[4], st);
    if (m[5] !== undefined) return tripleNode('u', m[5], st);
    if (m[6] !== undefined) return emphasis('strong', m[6], st);
    if (m[7] !== undefined) return emphasis('u', m[7], st);
    if (m[8] !== undefined) return emphasis('s', m[8], st);
    const italic = m[9] ?? m[10];
    return italic === undefined ? null : emphasis('em', italic, st);
}

/** Maps one regex match onto its node(s). */
function matchNodes(m: RegExpExecArray, st: ParseState): DiscordNode[] {
    const styled = styleNode(m, st);
    if (styled !== null) return [styled];
    const { ctx } = st;
    if (m[12] !== undefined) return [linkNode(m, st)];
    if (m[13] !== undefined) return [timeNode(m)];
    if (m[15] !== undefined) return [{ kind: 'text', text: `:${m[15]}:` }];
    if (m[16] !== undefined) return [mentionNode('@', findMention(ctx, m[16], 'user'), 'user')];
    if (m[17] !== undefined) return [mentionNode('@', findMention(ctx, m[17], 'role'), 'role')];
    if (m[18] !== undefined) return [channelNode(m[18], ctx)];
    return urlNode(m[19] ?? m[0], st);
}

function parseAt(input: string, st: ParseState): DiscordNode[] {
    if (st.depth > MAX_DEPTH) return [{ kind: 'text', text: input }];
    const out: DiscordNode[] = [];
    const re = new RegExp(INLINE_SOURCE, 'g');
    let cursor = 0;
    for (let m = re.exec(input); m !== null; m = re.exec(input)) {
        pushText(out, input.slice(cursor, m.index));
        for (const node of matchNodes(m, st)) {
            if (node.kind === 'text') pushText(out, node.text);
            else out.push(node);
        }
        cursor = m.index + m[0].length;
    }
    pushText(out, input.slice(cursor));
    return out;
}

/**
 * Parses Discord markup (assumed hostile) into renderable nodes.
 *
 * @param text verbatim Discord text — message content, embed title or description
 * @param ctx mentions and channel names to resolve `<@id>` / `<#id>` against
 * @returns a node tree; anything the grammar does not match survives as text
 */
export function parseDiscordMarkup(text: string, ctx: DiscordMarkupContext): DiscordNode[] {
    return parseAt(text, { ctx, depth: 0, links: true });
}
