/**
 * ROK-2208 Q10 (option c, RULED 2026-11-16) — the unbound "Discord forum"
 * form: the preflight Ready / Missing line (or the bot-offline line), the
 * list `RadioGroup` shared `#hub-forums` (preselected while it has a free
 * tag slot; disabled with the reason once full) vs this hub's own channel
 * (segmented Create / Use existing), the visibility acknowledgement naming
 * the chosen channel (R1), and "Turn on sync", disabled until ticked and
 * nothing is missing. Bind errors render in plain words; a reserved own
 * name shows on the name field.
 */
import { useState, type JSX } from 'react';
import { Button } from '../../ui/button';
import { Checkbox } from '../../ui/checkbox';
import { forumDiscordAckLabel } from '../hub-copy';
import type { HubForumDiscordChannelOption, HubForumDiscordPreflight } from './hub-forum-discord-api';
import { OwnPick, ReadyLine, TargetPick } from './hub-forum-discord-bind-parts';
import {
    canTurnOn, chosenChannelName, initialForumChoice, missingFor, toPutInput, type ForumDiscordChoice,
} from './hub-forum-discord-choice';
import { bindErrorMessage, nameFieldError } from './hub-forum-discord-errors';
import { useBindHubForumDiscord } from './use-hub-forum-discord';

function PreflightLine({ preflight, missing }: { preflight: HubForumDiscordPreflight; missing: readonly string[] }): JSX.Element {
    if (!preflight.botOnline) {
        return <p className="text-sm text-muted" data-testid="hub-forum-discord-offline">The Discord bot is offline. You can turn on sync once it’s back.</p>;
    }
    return <ReadyLine missing={missing} ready="The bot can create and manage forum posts, threads and webhooks here." testId="hub-forum-discord-preflight" />;
}

function firstOpenChannel(channels: readonly HubForumDiscordChannelOption[]): string {
    return channels.find((c) => c.tagsFree > 0)?.id ?? '';
}

export interface HubForumDiscordBindFormProps {
    guildId: number;
    preflight: HubForumDiscordPreflight;
    /** Forum channels for "Use an existing forum"; empty while the bot is offline. */
    channels: readonly HubForumDiscordChannelOption[];
}

/** The opt-in form; the caller renders it only for viewers who may bind. */
export function HubForumDiscordBindForm({ guildId, preflight, channels }: HubForumDiscordBindFormProps): JSX.Element {
    const [choice, setChoice] = useState<ForumDiscordChoice>(() => initialForumChoice(preflight));
    const [ack, setAck] = useState(false);
    const bind = useBindHubForumDiscord(guildId);
    const update = (next: Partial<ForumDiscordChoice>): void => {
        const merged = { ...choice, ...next };
        setChoice(merged.mode === 'existing' && merged.channelId === '' ? { ...merged, channelId: firstOpenChannel(channels) } : merged);
        bind.reset();
    };
    const missing = missingFor(choice, preflight, channels);
    const alert = bind.error ? bindErrorMessage(bind.error) : null;
    return (
        <div className="flex flex-col gap-3" data-testid="hub-forum-discord-form">
            <PreflightLine preflight={preflight} missing={missing} />
            <TargetPick preflight={preflight} value={choice.target} disabled={!preflight.botOnline} onChange={(target) => update({ target })} />
            {choice.target === 'own' && preflight.botOnline && <OwnPick choice={choice} channels={channels} nameError={nameFieldError(bind.error)} onChange={update} />}
            <Checkbox label={forumDiscordAckLabel(chosenChannelName(choice, preflight, channels))} checked={ack} data-testid="hub-forum-discord-ack"
                onChange={(e) => setAck(e.target.checked)} />
            {alert && <p role="alert" className="text-sm text-danger" data-testid="hub-forum-discord-bind-error">{alert}</p>}
            <div>
                <Button size="sm" onClick={() => bind.mutate(toPutInput(choice))} disabled={!canTurnOn(choice, ack, preflight, channels)}
                    loading={bind.isPending} data-testid="hub-forum-discord-turn-on">Turn on sync</Button>
            </div>
        </div>
    );
}
