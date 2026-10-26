/**
 * ROK-1941 D1/D2 — the settings sheet's "Pictures" section (game-server hubs,
 * Leader / staff): which Discord channel's death and screenshot posts land in
 * the Gallery. A separate setting from the mirror channel (OQ2) but pre-filled
 * with it while unset, so one click saves it. Same primitives as the Discord
 * picker (`Field` + `Select` + `Button`) and the same channel list.
 */
import { useState, type JSX } from 'react';
import type { GuildDiscordChannelOptionDto } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { Field } from '../../ui/field';
import { Select } from '../../ui/select';
import { channelOptionLabel } from '../discord/guild-discord.helpers';
import { useGuildDiscordChannels } from '../discord/use-guild-discord';
import { HubMediaBackfillRow } from './hub-media-backfill-row';
import type { HubMediaChannelState } from './hub-media-channel-api';
import { initialMediaChoice } from './hub-media-channel.helpers';
import { SettingsSection } from './settings-rows';
import { useClearHubMediaChannel, useHubMediaChannel, useSetHubMediaChannel } from './use-hub-media-channel';

function channelHint(state: HubMediaChannelState, choiceId: string): JSX.Element | string {
    if (!state.channelId && state.suggestedChannelId && choiceId === state.suggestedChannelId) {
        return <span data-testid="hub-media-channel-suggested">Pre-filled with the mirrored channel. Save to use it here too.</span>;
    }
    if (state.channelId && !state.channelName) return 'Raid Ledger can’t read the bound channel right now.';
    return 'Death and screenshot posts here land in the Gallery.';
}

interface FormProps { guildId: number; state: HubMediaChannelState; options: GuildDiscordChannelOptionDto[] }

function ChannelForm({ guildId, state, options }: FormProps): JSX.Element {
    const [choiceId, setChoiceId] = useState<string>(() => initialMediaChoice(state));
    const set = useSetHubMediaChannel(guildId);
    const clear = useClearHubMediaChannel(guildId);
    const error = set.error ?? clear.error;
    const canSave = choiceId !== '' && choiceId !== (state.channelId ?? '');
    const choose = (id: string): void => { setChoiceId(id); set.reset(); clear.reset(); };
    return (
        <>
            <Field label="Pictures channel" hint={channelHint(state, choiceId)} error={error ? error.message : undefined}>
                <Select value={choiceId} placeholder="Choose a channel" data-testid="hub-media-channel-select"
                    onChange={(e) => choose(e.target.value)}>
                    {options.map((c) => <option key={c.id} value={c.id}>{channelOptionLabel(c)}</option>)}
                </Select>
            </Field>
            <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => set.mutate(choiceId)} disabled={!canSave} loading={set.isPending}
                    data-testid="hub-media-channel-save">Save</Button>
                {state.channelId && (
                    <Button variant="destructive-soft" size="sm" onClick={() => clear.mutate(undefined, { onSuccess: () => setChoiceId('') })}
                        loading={clear.isPending} data-testid="hub-media-channel-remove">Remove channel</Button>
                )}
            </div>
        </>
    );
}

function SectionBody({ guildId }: { guildId: number }): JSX.Element {
    const state = useHubMediaChannel(guildId);
    const channels = useGuildDiscordChannels(guildId, true);
    if (state.isError || channels.isError) {
        return <p role="alert" className="text-sm text-danger" data-testid="hub-media-channel-error">Couldn’t load the pictures channel. Try again later.</p>;
    }
    if (!state.data || !channels.data) {
        return <p className="text-sm text-secondary" data-testid="hub-media-channel-loading">Loading…</p>;
    }
    if (!channels.data.connected) {
        return <p className="text-sm text-muted">Discord isn’t connected right now, so channels can’t be listed.</p>;
    }
    return (
        <>
            <ChannelForm key={state.data.channelId ?? 'unset'} guildId={guildId} state={state.data} options={channels.data.channels} />
            {state.data.channelId && <HubMediaBackfillRow guildId={guildId} />}
        </>
    );
}

/** The "Pictures" section; the sheet mounts it for game-server hubs inside its Leader gate. */
export function HubMediaChannelSection({ guildId }: { guildId: number }): JSX.Element {
    return (
        <SettingsSection title="Pictures" testId="guild-settings-pictures"
            blurb="The Discord channel whose death and screenshot posts feed this hub’s Gallery.">
            <SectionBody guildId={guildId} />
        </SettingsSection>
    );
}
