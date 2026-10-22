/**
 * ROK-1878 — renders Discord's inline markup (`parseDiscordMarkup`) as React
 * elements: bold, italic, underline, strike, code, safe links, viewer-local
 * `<t:…>` timestamps and named mentions. React escapes every text node, so a
 * raw `<b>` in Discord text can only ever show as text.
 *
 * Inline only: wrap it in your own block element (with `whitespace-pre-line`
 * when newlines matter).
 */
import { useMemo, type JSX, type ReactNode } from 'react';
import type { ThreadMessageMentionDto } from '@raid-ledger/contract';
import { parseDiscordMarkup, type DiscordChannelName, type DiscordNode } from './discord-markup.parse';
import { discordTimestampDate, formatDiscordTimestamp } from './discord-markup-time';

export interface DiscordMarkupProps {
    /** Verbatim Discord text (message content, embed title or description). */
    text: string;
    /** Mentions resolved at read time; unresolved ones render `@user` / `@role` / `#channel`. */
    mentions?: ThreadMessageMentionDto[];
    /** Channels the caller can name (e.g. the mirror's bound channel). */
    channels?: DiscordChannelName[];
}

const LINK_CLASS = 'text-success underline underline-offset-2 hover:no-underline';
const CODE_CLASS = 'rounded bg-overlay px-1 font-mono text-xs';
const MENTION_CLASS = 'rounded bg-overlay px-1 font-medium text-foreground';

function TimeNode({ node }: { node: Extract<DiscordNode, { kind: 'time' }> }): JSX.Element {
    const date = discordTimestampDate(node.unix);
    const iso = date?.toISOString() ?? '';
    return (
        <time dateTime={iso} title={formatDiscordTimestamp(node.unix, 'F') ?? undefined}>
            {formatDiscordTimestamp(node.unix, node.style) ?? node.raw}
        </time>
    );
}

function renderNodes(nodes: DiscordNode[]): ReactNode[] {
    return nodes.map((node, i) => renderNode(node, i));
}

function renderNode(node: DiscordNode, key: number): ReactNode {
    switch (node.kind) {
        case 'text': return node.text;
        case 'strong': return <strong key={key} className="font-semibold">{renderNodes(node.children)}</strong>;
        case 'em': return <em key={key}>{renderNodes(node.children)}</em>;
        case 'u': return <u key={key}>{renderNodes(node.children)}</u>;
        case 's': return <s key={key}>{renderNodes(node.children)}</s>;
        case 'code': return <code key={key} className={CODE_CLASS}>{node.text}</code>;
        case 'mention': return <span key={key} data-testid="discord-mention" className={MENTION_CLASS}>{node.display}</span>;
        case 'time': return <TimeNode key={key} node={node} />;
        case 'link':
            return (
                <a key={key} href={node.href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
                    {renderNodes(node.children)}
                </a>
            );
    }
}

const NO_MENTIONS: ThreadMessageMentionDto[] = [];
const NO_CHANNELS: DiscordChannelName[] = [];

/**
 * Safe inline renderer for Discord text.
 *
 * @param props the text plus whatever mentions / channel names can resolve its tokens
 * @returns a fragment of inline elements
 */
export function DiscordMarkup({ text, mentions = NO_MENTIONS, channels = NO_CHANNELS }: DiscordMarkupProps): JSX.Element {
    const nodes = useMemo(() => parseDiscordMarkup(text, { mentions, channels }), [text, mentions, channels]);
    return <>{renderNodes(nodes)}</>;
}
