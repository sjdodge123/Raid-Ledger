/**
 * ROK-1830 S4 — the channel picker's new home. It used to be mounted by the
 * mirror card; it is now opened from the settings sheet (Leader + admin only,
 * D10/Q4), so the hub frame mounts it and resolves the current binding from
 * the same cached mirror query the card reads. `GuildDiscordPicker` itself is
 * unchanged — only who may reach it moved.
 */
import type { JSX } from 'react';
import { boundChannelId, managedGameName } from './guild-discord.helpers';
import { GuildDiscordPicker } from './guild-discord-picker';
import { useGuildDiscord } from './use-guild-discord';

export function HubDiscordPickerMount({ guildId, onClose }: { guildId: number; onClose: () => void }): JSX.Element | null {
    const query = useGuildDiscord(guildId);
    if (query.isPending) return null;
    return <GuildDiscordPicker guildId={guildId} currentId={boundChannelId(query.data)}
        managedFor={managedGameName(query.data)} onClose={onClose} />;
}
