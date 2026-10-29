/** ROK-1955 — `/link` copy and hrefs shared by the cards. */
import type { CompanionLinkErrorKind } from '../../hooks/use-companion-link';

/** Where "Manage devices" goes (the L6 card's anchor on My Integrations). */
export const MANAGE_DEVICES_HREF = '/profile/integrations#companion-devices';

/** Error kind → the sentence shown to the user. */
export const LINK_ERROR_COPY: Record<CompanionLinkErrorKind, string> = {
    not_found: "That code isn't valid or has expired. Start again on your computer.",
    rate_limited: 'Too many tries. Wait a few minutes and try again.',
    device_limit: 'You have 10 linked devices. Remove one to link another.',
    other: 'Something went wrong. Try again.',
};
