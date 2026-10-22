/**
 * ROK-1788 — pure helpers for the guild Discord mirror card and picker.
 */
import type {
    GuildDiscordChannelOptionDto, GuildDiscordMessageDto, GuildDiscordMirrorDto,
} from '@raid-ledger/contract';

/** Approved prototype `compact`: the card shows the newest 3 (operator ruling Q3). */
export const MIRROR_VISIBLE_MESSAGES = 3;

/** The server sends up to 10, oldest first; keep the newest `n`, still oldest first. */
export function latestMessages(messages: GuildDiscordMessageDto[], n = MIRROR_VISIBLE_MESSAGES): GuildDiscordMessageDto[] {
    return n > 0 ? messages.slice(-n) : [];
}

/** The card heading: `#name` when the channel name is known. */
export function mirrorTitle(mirror: GuildDiscordMirrorDto): string {
    switch (mirror.state) {
        case 'ok': return `#${mirror.channel.name}`;
        case 'no-access':
        case 'gone': return mirror.channelName ? `#${mirror.channelName}` : 'Discord channel';
        default: return 'Discord channel';
    }
}

/**
 * Public channels always; private ones only once "Show private channels" is
 * ticked (D8) — except `keepId`, the current choice, so a bound private
 * channel still shows as selected.
 */
export function visibleChannels(
    channels: GuildDiscordChannelOptionDto[], showPrivate: boolean, keepId: string | null = null,
): GuildDiscordChannelOptionDto[] {
    return channels.filter((c) => showPrivate || c.visibility === 'public' || c.id === keepId);
}

/** `#name`, tagged when private. */
export function channelOptionLabel(channel: GuildDiscordChannelOptionDto): string {
    return channel.visibility === 'private' ? `#${channel.name} (private)` : `#${channel.name}`;
}

/** The bound channel id, whatever state the mirror is in. */
export function boundChannelId(mirror: GuildDiscordMirrorDto | undefined): string | null {
    if (!mirror || mirror.state === 'unset') return null;
    if (mirror.state === 'ok') return mirror.channel.id;
    return mirror.channelId;
}

/** Save needs a choice, and a private choice needs the acknowledgement (D7). */
export function canSaveChoice(choice: GuildDiscordChannelOptionDto | undefined, ack: boolean): boolean {
    if (!choice) return false;
    return choice.visibility === 'public' || ack;
}

/** "the <server> Discord", or "the community Discord" when the server is unknown. */
function serverPhrase(serverName: string | undefined): string {
    return serverName ? `the ${serverName} Discord` : 'the community Discord';
}

/** Card blurb (approved copy "Latest from the <server> Discord"). */
export function mirrorBlurb(mirror: GuildDiscordMirrorDto | undefined): string {
    const serverName = mirror?.state === 'ok' ? mirror.channel.serverName : undefined;
    return `Latest from ${serverPhrase(serverName)}`;
}

/** Picker hint naming the bot's server (operator ruling Q7). */
export function pickerHint(serverName: string | undefined): string {
    return `Channels in ${serverPhrase(serverName)} that Raid Ledger can read.`;
}

/**
 * ROK-1428 — the game a lifecycle-linked channel was created for, when the
 * mirror says the channel came from the automation (`channelSource: 'auto'`).
 */
export function managedGameName(mirror: GuildDiscordMirrorDto | undefined): string | null {
    if (mirror?.state !== 'ok' || mirror.channelSource !== 'auto') return null;
    return mirror.managedFor?.gameName ?? null;
}

/** Hint under the picker's select for an auto-linked channel. */
export function managedChannelHint(gameName: string): string {
    return `Created by Raid Ledger for ${gameName}. Pick another channel to override.`;
}
