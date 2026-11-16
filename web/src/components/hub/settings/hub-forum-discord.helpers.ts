/**
 * ROK-2208 S3 — pure helpers for the "Discord forum" settings section:
 * who may bind (§6), the existing-forum picker's labels, and the bound
 * state's lines. The form's choice state lives in `hub-forum-discord-choice.ts`.
 */
import type { GuildPage } from '@raid-ledger/contract';
import type { HubForumDiscordBinding, HubForumDiscordChannelOption } from './hub-forum-discord-api';
import { permissionList } from './hub-forum-discord-errors';

/**
 * The api's `canManageDiscord` (§6, OQ-7): staff on every hub kind, plus a
 * community hub's Leader. A Leader of any other kind reads the status only.
 */
export function canBindForumDiscord(page: GuildPage): boolean {
    if (page.viewer.isStaff === true) return true;
    return page.guild.kind === 'game_community' && page.viewer.canManageEditors;
}

/**
 * "#raids · shared with 2 hubs · missing Manage Webhooks", "… · full" when
 * no tag slot is left. A native `<option>` can't hold a chip, so the
 * Ready/Missing state is spelled out here and the chosen forum gets a chip.
 */
export function forumChannelLabel(option: HubForumDiscordChannelOption): string {
    const parts = [`#${option.name}`];
    if (option.sharedWith > 0) parts.push(`shared with ${option.sharedWith} ${option.sharedWith === 1 ? 'hub' : 'hubs'}`);
    if (option.tagsFree === 0) parts.push('full (20 of 20 tags)');
    const missing = option.missingPermissions ?? [];
    if (missing.length > 0) parts.push(`missing ${permissionList(missing)}`);
    return parts.join(' · ');
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
            const list = permissionList(binding.missingPermissions);
            return `The bot is missing permissions in this forum${list ? `: ${list}` : ''}.`;
        }
    }
}
