/**
 * ROK-2208 Q10 (option c, RULED) — the pieces of the unbound form: the
 * preflight Ready / Missing line, the "where posts go" choice (shared
 * `#event-planning` vs this hub's own channel), and the own-channel controls
 * (segmented Create / Use existing, the name input or the forum `Select`).
 * The picked forum's Ready / Missing shows once, on the form's preflight
 * line (mockup), not again under the `Select`. Tokens only.
 */
import type { JSX } from 'react';
import { HUB_FORUM_DISCORD_DEFAULT_CHANNEL_NAME, HUB_FORUM_DISCORD_TAG_LIMIT } from '@raid-ledger/contract';
import { Field } from '../../ui/field';
import { Input } from '../../ui/input';
import { RadioGroup, type RadioOption } from '../../ui/radio-group';
import { Select } from '../../ui/select';
import { StatusChip } from '../../ui/status-chip';
import type {
    HubForumDiscordChannelOption, HubForumDiscordMode, HubForumDiscordPreflight, HubForumDiscordTarget,
} from './hub-forum-discord-api';
import { sharedAvailable, type ForumDiscordChoice } from './hub-forum-discord-choice';
import { permissionList } from './hub-forum-discord-errors';
import { forumChannelLabel } from './hub-forum-discord.helpers';

interface ReadyProps { missing: readonly string[]; ready: string; testId: string }

/** Ready (success) or Missing (danger) + the permissions the bot lacks. */
export function ReadyLine({ missing, ready, testId }: ReadyProps): JSX.Element {
    const ok = missing.length === 0;
    return (
        <div className="flex flex-wrap items-center gap-2 text-sm" data-testid={testId}>
            <StatusChip tone={ok ? 'success' : 'danger'} title="Bot permissions">{ok ? 'Ready' : 'Missing'}</StatusChip>
            <span className="text-secondary">{ok ? ready : `The bot is missing ${permissionList(missing)} on Discord. Give it ${missing.length === 1 ? 'that permission' : 'those permissions'}, then come back.`}</span>
        </div>
    );
}

function sharedOption(preflight: HubForumDiscordPreflight): RadioOption<HubForumDiscordTarget> {
    const shared = preflight.shared;
    const name = `#${shared?.name ?? HUB_FORUM_DISCORD_DEFAULT_CHANNEL_NAME}`;
    if (shared && shared.tagsFree === 0) {
        return { value: 'shared', label: 'Shared server forum', disabled: true,
            description: `${name} is full: it already carries Discord’s maximum of ${String(HUB_FORUM_DISCORD_TAG_LIMIT)} tags. New hubs get their own channel.` };
    }
    const made = shared?.channelId ? `shared with ${String(shared.sharedWith)} ${shared.sharedWith === 1 ? 'hub' : 'hubs'}` : 'the bot creates it';
    const used = shared ? ` ${String(shared.tagsUsed)} of ${String(HUB_FORUM_DISCORD_TAG_LIMIT)} tags used.` : '';
    return { value: 'shared', label: 'Shared server forum (recommended)', disabled: !sharedAvailable(preflight),
        description: `${name}, ${made}. This hub gets its own tag so posts land in the right hub.${used}` };
}

const OWN: RadioOption<HubForumDiscordTarget> = {
    value: 'own', label: 'This hub’s own channel', description: 'A forum only for this hub, so no tags. Pick this for a members-only hub.',
};

interface TargetProps { preflight: HubForumDiscordPreflight; value: HubForumDiscordTarget; disabled: boolean; onChange: (t: HubForumDiscordTarget) => void }

/** "Where posts go on Discord": the shared forum or this hub's own channel. */
export function TargetPick({ preflight, value, disabled, onChange }: TargetProps): JSX.Element {
    return <RadioGroup label="Where posts go on Discord" options={[sharedOption(preflight), OWN]} value={value} disabled={disabled} onChange={onChange} />;
}

const MODES: readonly RadioOption<HubForumDiscordMode>[] = [
    { value: 'create', label: 'Create a new forum' },
    { value: 'existing', label: 'Use an existing forum' },
];

interface ChannelPickProps { channelId: string; channels: readonly HubForumDiscordChannelOption[]; onPick: (id: string) => void }

function ChannelPick({ channelId, channels, onPick }: ChannelPickProps): JSX.Element {
    const hint = channels.length === 0 ? 'The bot can’t see any public forum channels yet.' : 'Only forums everyone in the server can see are listed.';
    return (
        <Field label="Discord forum" hint={hint}>
            <Select value={channelId} placeholder="Choose a forum" data-testid="hub-forum-discord-channel" onChange={(e) => onPick(e.target.value)}>
                {channels.map((c) => <option key={c.id} value={c.id} disabled={c.tagsFree === 0}>{forumChannelLabel(c)}</option>)}
            </Select>
        </Field>
    );
}

export interface OwnPickProps {
    choice: ForumDiscordChoice;
    channels: readonly HubForumDiscordChannelOption[];
    nameError: string | undefined;
    onChange: (next: Partial<ForumDiscordChoice>) => void;
}

/** This hub's own channel: create one (named after the hub) or use an existing forum. */
export function OwnPick({ choice, channels, nameError, onChange }: OwnPickProps): JSX.Element {
    const slug = choice.name.trim();
    return (
        <div className="flex flex-col gap-3 border-l-2 border-edge pl-3" data-testid="hub-forum-discord-own">
            <RadioGroup label="Own channel" hideLabel appearance="segmented" options={MODES} value={choice.mode} onChange={(mode) => onChange({ mode })} />
            {choice.mode === 'create' ? (
                <Field label="Forum name" error={nameError} hint={slug ? `The bot creates #${slug} and manages it.` : 'The bot names it after this hub.'}>
                    <Input value={choice.name} maxLength={100} data-testid="hub-forum-discord-name" onChange={(e) => onChange({ name: e.target.value })} />
                </Field>
            ) : <ChannelPick channelId={choice.channelId} channels={channels} onPick={(channelId) => onChange({ channelId })} />}
        </div>
    );
}
