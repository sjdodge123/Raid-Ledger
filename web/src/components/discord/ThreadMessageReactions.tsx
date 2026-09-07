/**
 * ROK-1506 — the read-only reaction pills under one mirrored message.
 *
 * Counts only, exactly as the API returns them (D11): a unicode emoji is a
 * text node, a custom emoji is an `<img>` from Discord's CDN whose `alt` is
 * the emoji name. The CDN url is a fixed https template and the ONLY value
 * interpolated into it is an id proven to be all digits — so no hostile string
 * can ever reach `src`; anything else degrades to the name as text, following
 * the `Avatar` fallback precedent in `ThreadMessageRow`.
 *
 * No handler, no picker, no title: reacting happens in Discord.
 */
import type { JSX } from 'react';
import type { ThreadMessageReactionDto } from '@raid-ledger/contract';

const EMOJI_CDN = 'https://cdn.discordapp.com/emojis/';
/** A Discord snowflake is digits and nothing else. */
const SNOWFLAKE = /^\d+$/;

/** The CDN url for a custom emoji, or `null` when the id is not a snowflake. */
export function customEmojiUrl(
    reaction: Pick<ThreadMessageReactionDto, 'id' | 'animated'>,
): string | null {
    if (reaction.id === null || !SNOWFLAKE.test(reaction.id)) return null;
    const ext = reaction.animated ? 'gif' : 'png';
    return `${EMOJI_CDN}${reaction.id}.${ext}?size=32`;
}

function ReactionPill({
    reaction,
}: {
    reaction: ThreadMessageReactionDto;
}): JSX.Element {
    const src = customEmojiUrl(reaction);
    return (
        <li
            data-testid="thread-message-reaction"
            className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-xs text-foreground"
        >
            {src === null ? (
                <span>{reaction.name}</span>
            ) : (
                <img src={src} alt={reaction.name} className="h-4 w-4" />
            )}
            <span
                data-testid="thread-message-reaction-count"
                className="tabular-nums text-muted"
            >
                {reaction.count}
            </span>
        </li>
    );
}

export interface ThreadMessageReactionsProps {
    /** The message's reaction counts, in Discord's first-reacted-first order. */
    reactions: ThreadMessageReactionDto[];
}

/**
 * Renders one pill per reaction, or nothing at all when there are none.
 *
 * @param props the reaction counts to render
 */
export function ThreadMessageReactions({
    reactions,
}: ThreadMessageReactionsProps): JSX.Element | null {
    if (reactions.length === 0) return null;
    return (
        <ul
            data-testid="thread-message-reactions"
            className="mt-1 flex flex-wrap gap-1"
        >
            {reactions.map((reaction) => (
                <ReactionPill key={reaction.key} reaction={reaction} />
            ))}
        </ul>
    );
}
