/**
 * ROK-2226 — `?discussion=1` on the event page opens the discussion panel in
 * place of the card (OQ-11: a signed-up non-member reads and writes the one
 * event thread from the event page, never through the members-only hub).
 */

import type { EventDiscussionReady } from '@raid-ledger/contract';
import { forumThreadHref } from '../../components/hub/forum/forum-link';
import { HUB_PAGE_PREFIX } from '../../components/routing/hub-paths';

/** The query flag the card's CTA sets. */
export const DISCUSSION_PARAM = 'discussion';

/** `/events/<id>?discussion=1` — the card's CTA target. */
export function discussionPanelHref(eventId: number): string {
    return `/events/${eventId}?${DISCUSSION_PARAM}=1`;
}

/** True when the location's search carries `discussion=1`. */
export function discussionOpenFromSearch(search: string): boolean {
    return new URLSearchParams(search).get(DISCUSSION_PARAM) === '1';
}

/** `/hubs/<id>?thread=<id>#forum` — the full thread on the hub's Forum tab. */
export function discussionThreadHref(
    d: Pick<EventDiscussionReady, 'guildId' | 'threadId'>,
): string {
    return `${HUB_PAGE_PREFIX}${d.guildId}${forumThreadHref(d.threadId)}`;
}

/**
 * The card CTA target (spec §7 / AC13): a hub member goes to the hub thread;
 * everyone else (signed-up non-member, creator, unknown) to the panel.
 */
export function discussionCtaHref(
    eventId: number,
    d: Pick<EventDiscussionReady, 'guildId' | 'threadId' | 'member'>,
): string {
    return d.member === true
        ? discussionThreadHref(d)
        : discussionPanelHref(eventId);
}
