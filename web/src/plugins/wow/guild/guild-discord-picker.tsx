/**
 * ROK-1788 — the editor-only Discord channel picker: a `Modal` at ≥1024px, a
 * `BottomSheet` below (design-system §4.4). Private channels stay hidden until
 * "Show private channels" is ticked and need the acknowledgement before Save
 * (D7/D8). Server refusals (400 / 403 / 409) show inline, verbatim.
 */
import { useState, type JSX } from 'react';
import type { GuildDiscordChannelListDto, GuildDiscordChannelOptionDto } from '@raid-ledger/contract';
import { BottomSheet } from '../../../components/ui/bottom-sheet';
import { Button } from '../../../components/ui/button';
import { Checkbox } from '../../../components/ui/checkbox';
import { Field } from '../../../components/ui/field';
import { Modal } from '../../../components/ui/modal';
import { Select } from '../../../components/ui/select';
import { useDirtyCloseGuard } from '../../../hooks/use-dirty-close-guard';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { canSaveChoice, channelOptionLabel, pickerHint, visibleChannels } from './guild-discord.helpers';
import { useClearGuildDiscordChannel, useGuildDiscordChannels, useSetGuildDiscordChannel } from './use-guild-discord';

interface PickerProps { guildId: number; currentId: string | null; onClose: () => void }

const ACK_LABEL = 'Every member who can open this guild page will see this channel’s messages.';

function usePickerForm({ guildId, currentId, onClose }: PickerProps) {
    const channels = useGuildDiscordChannels(guildId, true);
    const [choiceId, setChoiceId] = useState<string>(currentId ?? '');
    const [showPrivate, setShowPrivate] = useState(false);
    const [ack, setAck] = useState(false);
    const set = useSetGuildDiscordChannel(guildId);
    const clear = useClearGuildDiscordChannel(guildId);
    const list = channels.data?.channels ?? [];
    const choice = list.find((c) => c.id === choiceId);
    const choose = (id: string): void => { setChoiceId(id); setAck(false); set.reset(); clear.reset(); };
    const save = (): void => {
        if (!choice) return;
        const privateAck = choice.visibility === 'private' ? { privateAck: ack } : {};
        set.mutate({ channelId: choice.id, ...privateAck }, { onSuccess: onClose });
    };
    const remove = (): void => clear.mutate(undefined, { onSuccess: onClose });
    const error = set.error ?? clear.error;
    return {
        channels, list, choice, choiceId, choose, showPrivate, setShowPrivate, ack, setAck, save, remove,
        saving: set.isPending, removing: clear.isPending, errorText: error ? error.message : undefined,
        dirty: choiceId !== (currentId ?? ''), canSave: canSaveChoice(choice, ack) && choiceId !== (currentId ?? ''),
    };
}
type PickerForm = ReturnType<typeof usePickerForm>;

function ListStatus({ data, isError }: { data: GuildDiscordChannelListDto | undefined; isError: boolean }): JSX.Element | null {
    if (isError) return <p role="alert" className="text-sm text-danger" data-testid="guild-discord-channels-error">Couldn’t load the channel list. Try again later.</p>;
    if (!data) return <p className="text-sm text-muted" data-testid="guild-discord-channels-loading">Loading channels…</p>;
    if (!data.connected) return <p className="text-sm text-muted" data-testid="guild-discord-picker-disconnected">Discord isn’t connected right now, so channels can’t be listed.</p>;
    if (data.channels.length === 0) return <p className="text-sm text-muted" data-testid="guild-discord-picker-none">Raid Ledger can’t read any channels yet. Give the bot View Channel and Read Message History in Discord.</p>;
    return null;
}

function ChannelSelect({ form, options }: { form: PickerForm; options: GuildDiscordChannelOptionDto[] }): JSX.Element {
    return (
        <Field label="Channel" hint={pickerHint(form.channels.data?.serverName)} error={form.errorText}>
            <Select value={form.choiceId} placeholder="Choose a channel" data-testid="guild-discord-channel-select"
                onChange={(e) => form.choose(e.target.value)}>
                {options.map((c) => <option key={c.id} value={c.id}>{channelOptionLabel(c)}</option>)}
            </Select>
        </Field>
    );
}

function PickerBody({ form }: { form: PickerForm }): JSX.Element {
    const data = form.channels.data;
    const status = <ListStatus data={data} isError={form.channels.isError} />;
    if (!data || !data.connected || data.channels.length === 0 || form.channels.isError) {
        return <div className="flex flex-col gap-3" data-testid="guild-discord-picker-body">{status}{form.errorText && <p role="alert" className="text-sm text-danger" data-testid="guild-discord-picker-error">{form.errorText}</p>}</div>;
    }
    const options = visibleChannels(form.list, form.showPrivate, form.choiceId || null);
    return (
        <div className="flex flex-col gap-4" data-testid="guild-discord-picker-body">
            <ChannelSelect form={form} options={options} />
            <Checkbox label="Show private channels" checked={form.showPrivate} data-testid="guild-discord-show-private"
                onChange={(e) => form.setShowPrivate(e.target.checked)} />
            {form.choice?.visibility === 'private' && (
                <Checkbox label={ACK_LABEL} checked={form.ack} data-testid="guild-discord-private-ack"
                    onChange={(e) => form.setAck(e.target.checked)} />
            )}
        </div>
    );
}

function PickerFooter({ form, onCancel, hasBinding }: { form: PickerForm; onCancel: () => void; hasBinding: boolean }): JSX.Element {
    return (
        <>
            {hasBinding && (
                <Button variant="destructive-soft" onClick={form.remove} loading={form.removing} data-testid="guild-discord-remove">Remove channel</Button>
            )}
            <Button variant="secondary" onClick={onCancel}>Cancel</Button>
            <Button onClick={form.save} disabled={!form.canSave} loading={form.saving} data-testid="guild-discord-save">Save</Button>
        </>
    );
}

export function GuildDiscordPicker(props: PickerProps): JSX.Element {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const form = usePickerForm(props);
    const guard = useDirtyCloseGuard(form.dirty, props.onClose);
    const footer = <PickerFooter form={form} onCancel={guard.requestClose} hasBinding={props.currentId !== null} />;
    const shared = {
        isOpen: true, onClose: props.onClose, closeGuard: guard, discardMessage: 'Discard the channel change?',
        title: 'Discord channel', footer,
    };
    const body = <PickerBody form={form} />;
    if (isDesktop) return <Modal {...shared} maxWidth="max-w-lg">{body}</Modal>;
    return <BottomSheet {...shared}>{body}</BottomSheet>;
}
