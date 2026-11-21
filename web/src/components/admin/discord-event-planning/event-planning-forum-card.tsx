/**
 * ROK-2272 S5b — Admin → Discord "Event planning forum" card (spec §3.2).
 * Events, scheduling polls and lineups outside a hub post into ONE bound
 * Discord forum. With ≥2 bound forums the admin picks it here (the same
 * `Field` + `Select` the hub forum picker uses, saved on change); with one it
 * is used automatically and with none there is nothing to pick, so both
 * render a read-only line. Tokens only.
 */
import type { JSX } from 'react';
import type { EventPlanningForumCandidate, EventPlanningForumSettingsDto } from '@raid-ledger/contract';
import { Field } from '../../ui/field';
import { Select } from '../../ui/select';
import { StatusChip } from '../../ui/status-chip';
import { useEventPlanningForum, useSaveEventPlanningForum } from '../../../hooks/admin/use-event-planning-forum';

/** The api's warning when the bot is offline and forums cannot be listed. */
const BOT_OFFLINE = 'unknown';

/** The card, on the Discord Overview page. */
export function EventPlanningForumCard(): JSX.Element {
    const { data, isPending, isError } = useEventPlanningForum();
    return (
        <section className="bg-surface border border-edge rounded-xl p-6" aria-labelledby="event-planning-forum-title" data-testid="event-planning-forum-card">
            <h3 id="event-planning-forum-title" className="text-base font-semibold text-foreground">Event planning forum</h3>
            <p className="text-sm text-muted mt-1 mb-4">Where events, scheduling polls and lineups that aren’t in a hub get their Discord post.</p>
            <CardBody settings={data} isLoading={isPending} isError={isError} />
        </section>
    );
}

interface BodyProps { settings: EventPlanningForumSettingsDto | undefined; isLoading: boolean; isError: boolean }

function CardBody({ settings, isLoading, isError }: BodyProps): JSX.Element {
    if (isLoading) return <div className="h-6 bg-overlay rounded animate-pulse" data-testid="event-planning-forum-loading" />;
    if (isError || !settings) {
        return <p className="text-sm text-danger" role="alert" data-testid="event-planning-forum-error">Couldn’t load the event planning forum. Reload the page to try again.</p>;
    }
    return settings.candidates.length >= 2 ? <ForumPicker settings={settings} /> : <ReadOnlyLine settings={settings} />;
}

/** One bound forum ⇒ it is used; none ⇒ nothing to pick (or the bot is offline). */
function ReadOnlyLine({ settings }: { settings: EventPlanningForumSettingsDto }): JSX.Element {
    const only = settings.candidates[0];
    if (only) {
        return <p className="text-sm text-foreground" data-testid="event-planning-forum-using">Using <span className="font-mono">#{only.name}</span></p>;
    }
    if (settings.warning === BOT_OFFLINE) {
        return <p className="text-sm text-secondary" data-testid="event-planning-forum-offline">The bot is offline, so forums can’t be checked right now.</p>;
    }
    return (
        <div data-testid="event-planning-forum-none">
            <p className="text-sm text-foreground">Bind a hub forum first</p>
            <p className="text-xs text-muted mt-1">Turn on a hub’s Discord forum in its settings. Until then, events, polls and lineups outside a hub get no Discord post.</p>
        </div>
    );
}

function candidateLabel(c: EventPlanningForumCandidate): string {
    return c.managed ? `#${c.name} (made by the bot)` : `#${c.name}`;
}

/** ≥2 bound forums: the admin's pick, saved as soon as it changes. */
function ForumPicker({ settings }: { settings: EventPlanningForumSettingsDto }): JSX.Element {
    const save = useSaveEventPlanningForum();
    const picked = settings.candidates.some((c) => c.channelId === settings.channelId) ? (settings.channelId ?? '') : '';
    const resolved = settings.candidates.find((c) => c.channelId === settings.resolvedChannelId);
    return (
        <div className="flex flex-col gap-3">
            <Field label="Discord forum" hint="Hub posts keep going to each hub’s own forum." error={save.error?.message}>
                <Select value={picked} placeholder="Choose a forum" disabled={save.isPending} data-testid="event-planning-forum-select"
                    onChange={(e) => save.mutate(e.target.value === '' ? null : e.target.value)}>
                    {settings.candidates.map((c) => <option key={c.channelId} value={c.channelId}>{candidateLabel(c)}</option>)}
                </Select>
            </Field>
            <ResolvedLine resolved={resolved} />
        </div>
    );
}

/** What non-hub posts use right now; nothing ⇒ a warning to pick one. */
function ResolvedLine({ resolved }: { resolved: EventPlanningForumCandidate | undefined }): JSX.Element {
    return (
        <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="event-planning-forum-resolved">
            <StatusChip tone={resolved ? 'success' : 'warning'} title="Event planning forum">{resolved ? 'In use' : 'Not set'}</StatusChip>
            <span className="text-secondary">
                {resolved ? `Posting to #${resolved.name}` : 'Pick a forum. Until then, events, polls and lineups outside a hub get no Discord post.'}
            </span>
        </div>
    );
}
