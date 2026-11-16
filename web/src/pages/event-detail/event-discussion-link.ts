/**
 * ROK-2226 — `?discussion=1` on the event page opens the discussion panel in
 * place of the card (OQ-11: a signed-up non-member reads and writes the one
 * event thread from the event page, never through the members-only hub).
 */

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
