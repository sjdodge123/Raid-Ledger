/**
 * ROK-1573/1572/1571 — the LFG page's ONE top-of-page card, drawn with the
 * shared `JourneyHero` (H1-b), ported from the approved wireframe `WfLfgHero`:
 *
 *   badge line   → LOOKING FOR MEMBERS / FULL GROUP / EVENT SET
 *   headline row → "4 looking · 2 want to play now" + Participants chip
 *   sub line     → "Needs 1 more for a full group" (only while short)
 *   action row   → UNDER the card: one full-width primary "Start a scheduling
 *                  poll" + its note; in the event-set state "Open the event"
 *                  (no note). Right-aligned at intrinsic width from `lg`.
 *
 * `JourneyHero` has no under-card slot, so the row renders after it. No phase
 * ribbon (`noRibbon`): an LFG group has no lineup phases.
 */
import type { JSX, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LfgConvertedEventDto, LfgGroupDetailDto } from '@raid-ledger/contract';
import { JourneyHero } from '../../components/shared/journey-hero';
import { LFG_COPY, eventSetHeadline, heroHeadline, heroSub } from './lfg-copy';
import { LFG_HERO_PRIMARY_BTN, LFG_HERO_SECONDARY_BTN } from './lfg-action-buttons';

export interface LfgHeroProps {
    group: LfgGroupDetailDto;
    /** The event this group was locked into (`group.convertedEvent`), or null. */
    convertedEvent: LfgConvertedEventDto | null;
    /** The Participants chip, rendered in the headline row. */
    participants: ReactNode;
    /**
     * Set → BOTH under-card actions are disabled and this reads in place of the
     * note. One hint for both because one condition gates both: a viewer with
     * no intent can neither start the group's poll nor start it playing.
     */
    primaryDisabledHint?: string;
    onStartPoll: () => void;
    /** ROK-1613 — open the "Start playing right now?" confirm. */
    onStartNow: () => void;
}

const ROW = 'flex w-full flex-col items-stretch gap-1 lg:items-end';
/** The two under-card actions: stacked on a phone, inline right from `lg`. */
const ACTIONS = 'flex w-full flex-col gap-2 lg:w-auto lg:flex-row lg:justify-end';

/**
 * ROK-1613 AC1 — "Start playing now". Rendered in EVERY non-session state,
 * including once the group has locked into a future event: a scheduled event
 * is not a live session, so AC5 does not sanction hiding it there.
 */
function StartNowButton({ disabled, onStartNow }: { disabled: boolean; onStartNow: () => void }): JSX.Element {
    return (
        <button
            type="button"
            data-testid="lfg-hero-start-now"
            className={LFG_HERO_SECONDARY_BTN}
            disabled={disabled}
            onClick={onStartNow}
        >
            {LFG_COPY.startNow}
        </button>
    );
}

/** The shared caption under the actions — the refusal, or the poll's note. */
function ActionNote({ hint, fallback }: { hint?: string; fallback?: string }): JSX.Element | null {
    const text = hint ?? fallback;
    if (text == null) return null;
    return <p data-testid="lfg-start-poll-hint" className="text-xs text-muted">{text}</p>;
}

/**
 * The under-card actions while the group is still looking (or full).
 *
 * ROK-1613 AC1: "Start playing now" is ALWAYS here — never conditional on the
 * now-hand count or on how many people are looking.
 */
function PollRow({ hint, onStartPoll, onStartNow }: {
    hint?: string;
    onStartPoll: () => void;
    onStartNow: () => void;
}): JSX.Element {
    return (
        <div className={ROW}>
            <div className={ACTIONS}>
                <StartNowButton disabled={hint != null} onStartNow={onStartNow} />
                <button
                    type="button"
                    data-testid="lfg-hero-primary"
                    className={LFG_HERO_PRIMARY_BTN}
                    disabled={hint != null}
                    onClick={onStartPoll}
                >
                    {LFG_COPY.startSchedulingPoll}
                </button>
            </div>
            <ActionNote hint={hint} fallback={LFG_COPY.startPollHint} />
        </div>
    );
}

/**
 * The under-card row once the group became an event.
 *
 * Start-now rides along (AC1). The group is waiting on a FUTURE event, not
 * playing, so "we are on anyway, go" must stay expressible — before ROK-1613
 * this row was the one state that offered no way to start at all.
 */
function OpenEventRow({ eventId, hint, onStartNow }: {
    eventId: number;
    hint?: string;
    onStartNow: () => void;
}): JSX.Element {
    return (
        <div className={ROW}>
            <div className={ACTIONS}>
                <StartNowButton disabled={hint != null} onStartNow={onStartNow} />
                <Link to={`/events/${eventId}`} data-testid="lfg-hero-primary" className={LFG_HERO_PRIMARY_BTN}>
                    {LFG_COPY.playingNowOpenEvent}
                </Link>
            </div>
            <ActionNote hint={hint} />
        </div>
    );
}

/** The hero card for the group (or for the event it became). */
export function LfgHero(props: LfgHeroProps): JSX.Element {
    const { group, convertedEvent: event, participants } = props;
    const badge = event ? LFG_COPY.badgeEventSet : group.isViable ? LFG_COPY.badgeFull : LFG_COPY.badgeLooking;
    return (
        <div data-testid="lfg-hero" className="space-y-3">
            <div data-testid={event ? 'lfg-converted-event' : undefined}>
                <JourneyHero
                    noRibbon
                    tone={event ? 'set' : 'action'}
                    donePillLabel={event ? LFG_COPY.eventSetPill : undefined}
                    badge={badge}
                    task={event ? eventSetHeadline(event.startTime, event.signupCount) : heroHeadline(group.activeCount, group.nowCount)}
                    sub={event ? undefined : heroSub(group.activeCount, group.viabilityThreshold)}
                    action={participants}
                />
            </div>
            {event
                ? <OpenEventRow eventId={event.eventId} hint={props.primaryDisabledHint} onStartNow={props.onStartNow} />
                : <PollRow hint={props.primaryDisabledHint} onStartPoll={props.onStartPoll} onStartNow={props.onStartNow} />}
        </div>
    );
}
