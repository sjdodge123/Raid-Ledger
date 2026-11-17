/**
 * ROK-2208 S3 — who a forum message shows as. A linked author shows as
 * themselves; a Discord author with no Raid Ledger account shows under their
 * Discord name (R2). Every Discord-origin message carries the "via Discord"
 * chip, guest or linked (Q10 mockup). A deleted user keeps "Former member".
 */
import type { HubForumDiscordAuthor, HubForumSource, HubPostPerson } from '@raid-ledger/contract';

/** The fields a thread summary and a reply share for the byline. */
export interface ForumBylineSource {
    author: HubPostPerson | null;
    source?: HubForumSource | undefined;
    discordAuthor?: HubForumDiscordAuthor | null | undefined;
}

export interface ForumByline { name: string; avatarUrl: string | null; viaDiscord: boolean }

/** Name, avatar and the "via Discord" flag for one message. */
export function forumByline(message: ForumBylineSource): ForumByline {
    const guest = message.author === null ? (message.discordAuthor ?? null) : null;
    return {
        name: message.author?.displayName ?? guest?.name ?? 'Former member',
        avatarUrl: message.author?.avatarUrl ?? guest?.avatarUrl ?? null,
        viaDiscord: message.source === 'discord' || guest !== null,
    };
}
