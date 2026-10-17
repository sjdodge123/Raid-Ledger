/**
 * Shared responsive breakpoint media queries (ROK-1584).
 *
 * Every phone-vs-desktop layout switch in the scheduling / game-time / profile
 * surfaces reads these two constants so the boundary moves in one place. The
 * split sits at 1024px (Tailwind's `lg`) rather than 768px (`md`) because
 * tablets in portrait — an iPad is 810px wide — need the phone layouts
 * (bottom sheets, single-column ladders), not the desktop ones.
 *
 * Keep the Tailwind prefixes on those same components at `lg:` so the CSS and
 * the JS checks agree; a `md:` prefix next to `DESKTOP_MQ` is a bug on tablets.
 */

/** Matches viewports that get the desktop layout (1024px and up). */
export const DESKTOP_MQ = '(min-width: 1024px)';

/** Matches viewports that get the phone layout (1023px and below). */
export const PHONE_MQ = '(max-width: 1023px)';
