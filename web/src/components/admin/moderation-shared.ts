/** Shared helpers/constants for the admin kick/ban moderation modals (ROK-313). */

/** Target passed to the kick/ban confirm modals. */
export interface ModerationTarget {
    id: number;
    username: string;
    discordId?: string | null;
}

/**
 * True only when `discordId` is a real Discord snowflake, not a placeholder.
 * Local accounts carry `local:*` and unlinked-but-known accounts carry
 * `unlinked:*`, neither of which can be guild-kicked (ROK-313 §6d).
 */
export function isRealDiscordId(discordId: string | null | undefined): discordId is string {
    return !!discordId && !discordId.startsWith('local:') && !discordId.startsWith('unlinked:');
}
