/**
 * ROK-2208 S3 — pure helpers for the "Discord forum" settings section:
 * who may bind (§6), the picker's labels and default choice (Q10 ruling:
 * the shared `#hub-forums` is preselected while it has a free tag slot,
 * else "Create a new forum"), and the bound state's lines.
 */
import { HUB_FORUM_DISCORD_DEFAULT_CHANNEL_NAME, type GuildPage } from '@raid-ledger/contract';
import type { HubForumDiscordBinding, HubForumDiscordChannelOption, HubForumDiscordMode } from './hub-forum-discord-api';

/** The picker's current choice; `channelId` is '' for `create`. */
export interface ForumDiscordChoice { mode: HubForumDiscordMode; channelId: string }

/**
 * The api's `canManageDiscord` (§6, OQ-7): staff on every hub kind, plus a
 * community hub's Leader. A Leader of any other kind reads the status only.
 */
export function canBindForumDiscord(page: GuildPage): boolean {
    if (page.viewer.isStaff === true) return true;
    return page.guild.kind === 'game_community' && page.viewer.canManageEditors;
}

/** "#hub-forums · shared with 2 hubs", "… · full" when no tag slot is left. */
export function forumChannelLabel(option: HubForumDiscordChannelOption): string {
    const parts = [`#${option.name}`];
    if (option.sharedWith > 0) parts.push(`shared with ${option.sharedWith} ${option.sharedWith === 1 ? 'hub' : 'hubs'}`);
    if (option.tagsFree === 0) parts.push('full (20 of 20 tags)');
    return parts.join(' · ');
}

/** The first forum that can still take this hub, preferring `#hub-forums`. */
export function initialForumChoice(channels: readonly HubForumDiscordChannelOption[]): ForumDiscordChoice {
    const shared = channels.find((c) => c.name === HUB_FORUM_DISCORD_DEFAULT_CHANNEL_NAME && c.tagsFree > 0);
    return shared ? { mode: 'existing', channelId: shared.id } : { mode: 'create', channelId: '' };
}

/** Turn on stays disabled until the box is ticked and an existing pick is made. */
export function canTurnOn(choice: ForumDiscordChoice, ack: boolean): boolean {
    return ack && (choice.mode === 'create' || choice.channelId !== '');
}

/** "Shared with 2 other hubs · tag Valheim", or null for a hub's own forum. */
export function sharedLine(binding: HubForumDiscordBinding): string | null {
    if (!binding.shared) return null;
    const hubs = `${binding.sharedWith} other ${binding.sharedWith === 1 ? 'hub' : 'hubs'}`;
    return binding.tagName ? `Shared with ${hubs} · tag ${binding.tagName}` : `Shared with ${hubs}`;
}

/** "Also delete the Discord forum" is offered only for a bot-made, unshared forum. */
export function canDeleteForum(binding: HubForumDiscordBinding): boolean {
    return binding.managed && !binding.shared;
}

/** The health line under a bound forum; null when everything works. */
export function healthMessage(binding: HubForumDiscordBinding): string | null {
    switch (binding.health) {
        case 'ok': return null;
        case 'bot-offline': return 'The Discord bot is offline. Sync resumes when it reconnects.';
        case 'channel-missing': return 'The Discord forum was deleted or the bot can’t see it. Unlink, then link another forum.';
        case 'missing-perms': {
            const list = binding.missingPermissions.join(', ');
            return `The bot is missing permissions in this forum${list ? `: ${list}` : ''}.`;
        }
    }
}
