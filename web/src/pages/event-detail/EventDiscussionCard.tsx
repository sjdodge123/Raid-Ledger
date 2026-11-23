/**
 * ROK-2226 — the "Discussion" card on the event page (approved mockup, Q1:
 * after the Signups roster, before Activity). It previews the hub-tagged
 * event's forum thread: up to three newest replies (avatar, name, time, body
 * clamped to two lines), the reply count, and a CTA that NAVIGATES to the full
 * thread (Q2: no inline composer). States (spec §7):
 * hidden (logged out, untagged, hidden hub, `none`, error); loading skeleton;
 * empty; replies + "Join the discussion" (can reply); replies + "Sign up to
 * join the discussion" (can read, cannot reply); header + count only (cannot
 * read — the page's hub join prompt does the rest, ruling 16); Closed pill +
 * lock line + "Read the full thread" (locked). The CTA opens the
 * `?discussion=1` panel on this page (L4b, OQ-11). Tokens only.
 */
import type { JSX } from 'react';
import type { EventResponseDto } from '@raid-ledger/contract';
import {
    DiscussionCardSkeleton,
    SubjectDiscussionFrame,
} from '../../components/discussion/discussion-card-parts';
import {
    DiscussionFoot,
    type DiscussionSignup,
} from './event-discussion-card-parts';
import { useEventDiscussion } from './use-event-discussion';

export {
    DISCUSSION_EMPTY,
    DISCUSSION_SIGN_UP,
} from './event-discussion-card-parts';

export interface EventDiscussionCardProps {
    event: Pick<EventResponseDto, 'id' | 'guildId' | 'hub'>;
    /** False when logged out (ruling 15: the card is hidden). */
    enabled: boolean;
    /** The page's signup action while the viewer may still join (mockup reader state). */
    signup?: DiscussionSignup | undefined;
}

/** The event page Discussion card (see file docstring). */
export function EventDiscussionCard({
    event,
    enabled,
    signup,
}: EventDiscussionCardProps): JSX.Element | null {
    const visible = enabled && event.guildId != null && event.hub != null;
    const query = useEventDiscussion(event.id, visible);
    if (!visible || query.isError) return null;
    if (query.isPending) return <DiscussionCardSkeleton />;
    return query.data.state === 'none' ? null : (
        <SubjectDiscussionFrame
            kind="event"
            d={query.data}
            foot={
                <DiscussionFoot
                    eventId={event.id}
                    d={query.data}
                    signup={signup}
                />
            }
        />
    );
}
