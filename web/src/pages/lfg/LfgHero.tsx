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
import { LFG_HERO_PRIMARY_BTN } from './lfg-action-buttons';

export interface LfgHeroProps {
    group: LfgGroupDetailDto;
    /** The event this group was locked into (`group.convertedEvent`), or null. */
    convertedEvent: LfgConvertedEventDto | null;
    /** The Participants chip, rendered in the headline row. */
    participants: ReactNode;
    /** Set → the poll button is disabled and this reads in place of the note. */
    primaryDisabledHint?: string;
    onStartPoll: () => void;
}

const ROW = 'flex w-full flex-col items-stretch gap-1 lg:items-end';

/** The under-card row while the group is still looking (or full). */
function PollRow({ hint, onStartPoll }: { hint?: string; onStartPoll: () => void }): JSX.Element {
    return (
        <div className={ROW}>
            <button
                type="button"
                data-testid="lfg-hero-primary"
                className={LFG_HERO_PRIMARY_BTN}
                disabled={hint != null}
                onClick={onStartPoll}
            >
                {LFG_COPY.startSchedulingPoll}
            </button>
            <p data-testid="lfg-start-poll-hint" className="text-xs text-muted">
                {hint ?? LFG_COPY.startPollHint}
            </p>
        </div>
    );
}

/** The under-card row once the group became an event. */
function OpenEventRow({ eventId }: { eventId: number }): JSX.Element {
    return (
        <div className={ROW}>
            <Link to={`/events/${eventId}`} data-testid="lfg-hero-primary" className={LFG_HERO_PRIMARY_BTN}>
                {LFG_COPY.playingNowOpenEvent}
            </Link>
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
                ? <OpenEventRow eventId={event.eventId} />
                : <PollRow hint={props.primaryDisabledHint} onStartPoll={props.onStartPoll} />}
        </div>
    );
}
