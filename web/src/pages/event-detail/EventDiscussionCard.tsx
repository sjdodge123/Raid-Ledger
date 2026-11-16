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
import {
    ChatBubbleLeftRightIcon,
    LockClosedIcon,
} from '@heroicons/react/24/outline';
import type {
    EventDiscussionReady,
    EventResponseDto,
} from '@raid-ledger/contract';
import { Pill } from '../../components/hub/hub-bits';
import { replyCountLabel } from '../../components/hub/forum/forum-thread.helpers';
import {
    DiscussionFoot,
    DiscussionReplies,
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

function DiscussionFrame({
    eventId,
    d,
    signup,
}: {
    eventId: number;
    d: EventDiscussionReady;
    signup: DiscussionSignup | undefined;
}): JSX.Element {
    return (
        <section
            className="mb-6 rounded-xl border border-edge bg-surface p-4"
            data-testid="event-discussion-card"
            aria-labelledby="event-discussion-title"
        >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h2
                    id="event-discussion-title"
                    className="flex items-center gap-2 text-lg font-semibold text-foreground"
                >
                    <ChatBubbleLeftRightIcon
                        className="h-5 w-5 shrink-0"
                        aria-hidden="true"
                    />
                    Discussion
                    {d.lock !== null && (
                        <Pill>
                            <LockClosedIcon
                                className="h-3 w-3"
                                aria-hidden="true"
                            />
                            Closed
                        </Pill>
                    )}
                </h2>
                <span
                    className="text-xs text-muted"
                    data-testid="event-discussion-count"
                >
                    {replyCountLabel(d.replyCount)}
                </span>
            </div>
            {d.can.read && <DiscussionReplies replies={d.latestReplies} />}
            {d.can.read && (
                <DiscussionFoot eventId={eventId} d={d} signup={signup} />
            )}
        </section>
    );
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
    if (query.isPending) {
        return (
            <div
                className="mb-6 h-24 animate-pulse rounded-xl border border-edge bg-panel"
                aria-busy="true"
                aria-label="Loading discussion"
            />
        );
    }
    return query.data.state === 'none' ? null : (
        <DiscussionFrame eventId={event.id} d={query.data} signup={signup} />
    );
}
