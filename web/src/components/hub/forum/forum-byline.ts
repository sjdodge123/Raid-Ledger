/**
 * ROK-2208 S3 — who a forum message shows as. A linked author shows as
 * themselves; a Discord author with no Raid Ledger account shows under their
 * Discord name (R2). Every Discord-origin message carries the "via Discord"
 * chip, guest or linked (Q10 mockup). A deleted user keeps "Former member".
 * A banned or deactivated author (ROK-2328) stays linked server-side but
 * shows as "Deactivated member" with no avatar.
 */
import type { HubForumDiscordAuthor, HubForumSource, HubPostPerson } from '@raid-ledger/contract';

/** The fields a thread summary and a reply share for the byline. */
export interface ForumBylineSource {
    author: HubPostPerson | null;
    source?: HubForumSource | undefined;
    discordAuthor?: HubForumDiscordAuthor | null | undefined;
}

export interface ForumByline { name: string; avatarUrl: string | null; viaDiscord: boolean }

/** The one name every surface shows for a banned or deactivated author (ROK-2328). */
export const BLOCKED_AUTHOR_NAME = 'Deactivated member';

/** True for a banned or deactivated author (operator ruling 2026-11-27: both read the same). */
export function isBlockedAuthor(author: HubPostPerson | null | undefined): boolean {
    return author?.blocked != null;
}

/** Name, avatar and the "via Discord" flag for one message. */
export function forumByline(message: ForumBylineSource): ForumByline {
    const viaDiscord = message.source === 'discord';
    if (isBlockedAuthor(message.author)) return { name: BLOCKED_AUTHOR_NAME, avatarUrl: null, viaDiscord };
    const guest = message.author === null ? (message.discordAuthor ?? null) : null;
    return {
        name: message.author?.displayName ?? guest?.name ?? 'Former member',
        avatarUrl: message.author?.avatarUrl ?? guest?.avatarUrl ?? null,
        viaDiscord: message.source === 'discord' || guest !== null,
    };
}
