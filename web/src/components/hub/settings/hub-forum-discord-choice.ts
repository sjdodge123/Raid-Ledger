/**
 * ROK-2208 Q10 (option c, RULED) — the unbound form's choice as pure
 * state: the shared `#hub-forums` (preselected while it has a free tag
 * slot) or the hub's own channel, created (named after the hub) or an
 * existing forum. Derives the PUT body, the channel the acknowledgement
 * names, and the permissions the bot lacks for that choice.
 */
import type {
    HubForumDiscordChannelOption, HubForumDiscordMode, HubForumDiscordPreflight, HubForumDiscordTarget,
    PutHubForumDiscordInput,
} from './hub-forum-discord-api';

/** The form's choice; `channelId` is '' until an existing forum is picked. */
export interface ForumDiscordChoice { target: HubForumDiscordTarget; mode: HubForumDiscordMode; channelId: string; name: string }

/** The shared forum can take this hub: the bot is online and a tag slot is free. */
export function sharedAvailable(preflight: HubForumDiscordPreflight): boolean {
    return preflight.botOnline && preflight.shared !== null && preflight.shared.tagsFree > 0;
}

/** Shared when it has room (Q5 ruling), else the hub's own new forum. */
export function initialForumChoice(preflight: HubForumDiscordPreflight): ForumDiscordChoice {
    const target: HubForumDiscordTarget = sharedAvailable(preflight) ? 'shared' : 'own';
    return { target, mode: 'create', channelId: '', name: preflight.suggestedName };
}

/** The PUT body for a choice (the caller only submits once `ack` is ticked). */
export function toPutInput(choice: ForumDiscordChoice): PutHubForumDiscordInput {
    if (choice.target === 'shared') return { mode: 'create', target: 'shared', ack: true };
    if (choice.mode === 'existing') return { mode: 'existing', channelId: choice.channelId, ack: true };
    const name = choice.name.trim();
    return name ? { mode: 'create', target: 'own', name, ack: true } : { mode: 'create', target: 'own', ack: true };
}

/** The channel the acknowledgement names ('' when an existing forum isn't picked yet). */
export function chosenChannelName(choice: ForumDiscordChoice, preflight: HubForumDiscordPreflight, channels: readonly HubForumDiscordChannelOption[]): string {
    if (choice.target === 'shared') return preflight.shared?.name ?? '';
    if (choice.mode === 'existing') return channels.find((c) => c.id === choice.channelId)?.name ?? '';
    return choice.name.trim() || preflight.suggestedName;
}

/** Permissions the bot lacks for this choice: creating, or in the forum it would join. */
export function missingFor(choice: ForumDiscordChoice, preflight: HubForumDiscordPreflight, channels: readonly HubForumDiscordChannelOption[]): readonly string[] {
    if (choice.target === 'shared') {
        const shared = preflight.shared;
        return shared && shared.channelId !== null ? shared.missingPermissions : preflight.missingToCreate;
    }
    if (choice.mode === 'existing') return channels.find((c) => c.id === choice.channelId)?.missingPermissions ?? [];
    return preflight.missingToCreate;
}

/** Turn on: ticked, bot online, nothing missing, and an existing pick made. */
export function canTurnOn(choice: ForumDiscordChoice, ack: boolean, preflight: HubForumDiscordPreflight, channels: readonly HubForumDiscordChannelOption[]): boolean {
    if (!ack || !preflight.botOnline || missingFor(choice, preflight, channels).length > 0) return false;
    return choice.target === 'shared' || choice.mode === 'create' || choice.channelId !== '';
}
