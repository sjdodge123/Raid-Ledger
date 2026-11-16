/**
 * ROK-2208 S3 — the unbound "Discord forum" form (approved Q10 mockup):
 * a segmented `RadioGroup` "Create a new forum" / "Use an existing forum",
 * a `Select` of forum channels for `existing` (a full forum is disabled),
 * the visibility acknowledgement (`Checkbox`, R1), and "Turn on sync",
 * disabled until the box is ticked (§12: the 400 never leaves the client).
 */
import { useState, type JSX } from 'react';
import { HUB_FORUM_DISCORD_DEFAULT_CHANNEL_NAME } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { Checkbox } from '../../ui/checkbox';
import { Field } from '../../ui/field';
import { RadioGroup, type RadioOption } from '../../ui/radio-group';
import { Select } from '../../ui/select';
import { forumDiscordAckLabel } from '../hub-copy';
import type { HubForumDiscordChannelOption, HubForumDiscordMode } from './hub-forum-discord-api';
import { canTurnOn, forumChannelLabel, initialForumChoice, type ForumDiscordChoice } from './hub-forum-discord.helpers';
import { useBindHubForumDiscord } from './use-hub-forum-discord';

const MODES: readonly RadioOption<HubForumDiscordMode>[] = [
    { value: 'create', label: 'Create a new forum' },
    { value: 'existing', label: 'Use an existing forum' },
];

function chosenName(choice: ForumDiscordChoice, channels: readonly HubForumDiscordChannelOption[]): string {
    if (choice.mode === 'create') return HUB_FORUM_DISCORD_DEFAULT_CHANNEL_NAME;
    return channels.find((c) => c.id === choice.channelId)?.name ?? '';
}

interface ChannelPickProps { choice: ForumDiscordChoice; channels: readonly HubForumDiscordChannelOption[]; onPick: (id: string) => void }

function ChannelPick({ choice, channels, onPick }: ChannelPickProps): JSX.Element {
    const hint = channels.length === 0 ? 'The bot can’t see any forum channels yet.' : 'Several hubs can share one forum; each gets its own tag.';
    return (
        <Field label="Discord forum" hint={hint}>
            <Select value={choice.channelId} placeholder="Choose a forum" data-testid="hub-forum-discord-channel"
                onChange={(e) => onPick(e.target.value)}>
                {channels.map((c) => <option key={c.id} value={c.id} disabled={c.tagsFree === 0}>{forumChannelLabel(c)}</option>)}
            </Select>
        </Field>
    );
}

export interface HubForumDiscordBindFormProps { guildId: number; channels: readonly HubForumDiscordChannelOption[] }

/** The opt-in form; the caller renders it only for viewers who may bind. */
export function HubForumDiscordBindForm({ guildId, channels }: HubForumDiscordBindFormProps): JSX.Element {
    const [choice, setChoice] = useState<ForumDiscordChoice>(() => initialForumChoice(channels));
    const [ack, setAck] = useState(false);
    const bind = useBindHubForumDiscord(guildId);
    const name = chosenName(choice, channels);
    const submit = (): void => {
        bind.mutate(choice.mode === 'create' ? { mode: 'create', ack: true } : { mode: 'existing', channelId: choice.channelId, ack: true });
    };
    return (
        <div className="flex flex-col gap-3" data-testid="hub-forum-discord-form">
            <RadioGroup label="Forum channel" appearance="segmented" options={MODES} value={choice.mode}
                onChange={(mode) => { setChoice({ mode, channelId: mode === 'create' ? '' : initialForumChoice(channels).channelId }); bind.reset(); }} />
            {choice.mode === 'existing' && <ChannelPick choice={choice} channels={channels} onPick={(channelId) => setChoice({ mode: 'existing', channelId })} />}
            <Checkbox label={forumDiscordAckLabel(name)} checked={ack} data-testid="hub-forum-discord-ack"
                onChange={(e) => setAck(e.target.checked)} />
            {bind.error && <p role="alert" className="text-sm text-danger" data-testid="hub-forum-discord-bind-error">{bind.error.message}</p>}
            <div>
                <Button size="sm" onClick={submit} disabled={!canTurnOn(choice, ack)} loading={bind.isPending}
                    data-testid="hub-forum-discord-turn-on">Turn on sync</Button>
            </div>
        </div>
    );
}
