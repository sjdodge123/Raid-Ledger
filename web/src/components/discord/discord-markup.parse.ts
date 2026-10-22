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

const INLINE_SOURCE = [
    '\\\\([^A-Za-z0-9\\s])', // 1 escaped character
    '```([\\s\\S]+?)```', // 2 fenced code, shown inline
    '`([^`]+)`', // 3 inline code
    '\\*\\*([\\s\\S]+?)\\*\\*', // 4 bold
    '__([\\s\\S]+?)__', // 5 underline
    '~~([\\s\\S]+?)~~', // 6 strike
    '\\*([^*\\n]+?)\\*', // 7 italic (asterisk)
    '(?<![A-Za-z0-9])_([^_\\n]+?)_(?![A-Za-z0-9])', // 8 italic (underscore, word-bounded)
    '\\[([^\\]\\n]+)\\]\\(<?([^)\\s>]+)>?\\)', // 9 label, 10 href
    '<t:(-?\\d+)(?::([A-Za-z]))?>', // 11 unix seconds, 12 style
    '<a?:(\\w+):\\d+>', // 13 custom emoji name
    '<@!?(\\d+)>', // 14 user
    '<@&(\\d+)>', // 15 role
    '<#(\\d+)>', // 16 channel
    '<(https?://[^\\s>]+)>', // 17 embed-suppressed url
    'https?://[^\\s<>()\\[\\]]+', // bare url (no capture)
].join('|');

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
    const unix = Number(m[11]);
    const style = toTimestampStyle(m[12]);
    if (style === null || discordTimestampDate(unix) === null) return { kind: 'text', text: m[0] };
    return { kind: 'time', unix, style, raw: m[0] };
}

function urlNode(raw: string): DiscordNode[] {
    const href = raw.replace(/[.,!?;:]+$/, '');
    const tail: DiscordNode[] = href === raw ? [] : [{ kind: 'text', text: raw.slice(href.length) }];
    if (!isSafeMarkdownHref(href)) return [{ kind: 'text', text: raw }];
    return [{ kind: 'link', href, children: [{ kind: 'text', text: href }] }, ...tail];
}

function linkNode(m: RegExpExecArray, ctx: DiscordMarkupContext, depth: number): DiscordNode {
    const href = m[10] ?? '';
    if (!isSafeMarkdownHref(href)) return { kind: 'text', text: m[0] };
    return { kind: 'link', href, children: parseAt(m[9] ?? '', ctx, depth + 1) };
}

function emphasis(kind: 'strong' | 'em' | 'u' | 's', inner: string, ctx: DiscordMarkupContext, depth: number): DiscordNode {
    return { kind, children: parseAt(inner, ctx, depth + 1) };
}

/** Maps one regex match onto its node(s). */
function matchNodes(m: RegExpExecArray, ctx: DiscordMarkupContext, depth: number): DiscordNode[] {
    if (m[1] !== undefined) return [{ kind: 'text', text: m[1] }];
    const code = m[2] ?? m[3];
    if (code !== undefined) return [{ kind: 'code', text: code }];
    if (m[4] !== undefined) return [emphasis('strong', m[4], ctx, depth)];
    if (m[5] !== undefined) return [emphasis('u', m[5], ctx, depth)];
    if (m[6] !== undefined) return [emphasis('s', m[6], ctx, depth)];
    const italic = m[7] ?? m[8];
    if (italic !== undefined) return [emphasis('em', italic, ctx, depth)];
    if (m[10] !== undefined) return [linkNode(m, ctx, depth)];
    if (m[11] !== undefined) return [timeNode(m)];
    if (m[13] !== undefined) return [{ kind: 'text', text: `:${m[13]}:` }];
    if (m[14] !== undefined) return [mentionNode('@', findMention(ctx, m[14], 'user'), 'user')];
    if (m[15] !== undefined) return [mentionNode('@', findMention(ctx, m[15], 'role'), 'role')];
    if (m[16] !== undefined) return [channelNode(m[16], ctx)];
    return urlNode(m[17] ?? m[0]);
}

function parseAt(input: string, ctx: DiscordMarkupContext, depth: number): DiscordNode[] {
    if (depth > MAX_DEPTH) return [{ kind: 'text', text: input }];
    const out: DiscordNode[] = [];
    const re = new RegExp(INLINE_SOURCE, 'g');
    let cursor = 0;
    for (let m = re.exec(input); m !== null; m = re.exec(input)) {
        pushText(out, input.slice(cursor, m.index));
        for (const node of matchNodes(m, ctx, depth)) {
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
    return parseAt(text, ctx, 0);
}
