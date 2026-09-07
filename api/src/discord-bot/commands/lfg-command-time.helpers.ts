/**
 * ROK-1479 — the two `/lfg` expiry formatters, extracted from
 * `lfg.command.helpers.ts` to keep that file inside its 270-line budget.
 *
 * They are deliberately SEPARATE functions rather than one with a flag,
 * because they serve slots with opposite rules: Discord renders `<t:EPOCH:…>`
 * in an embed's description and field values, but NOT in its author line or
 * footer — and `applyEmbedChrome` THROWS when the markup reaches either
 * (`embed-chrome.helpers.ts::assertNoTimestampMarkup`). Collapsing them into
 * one formatter is how that guard gets tripped on a real post.
 */

/**
 * A plain `expires 17 Sep` footer label in the community timezone.
 *
 * NEVER `<t:…>`: Discord does not render a Unix timestamp in a footer, and
 * `applyEmbedChrome` throws on the markup anyway.
 *
 * @param expiresAt - ISO instant, or null when nothing expires.
 * @param timezone - IANA zone; falls back to the runtime default.
 * @returns `expires 17 Sep`, or null.
 */
export function formatExpiryLabel(
  expiresAt: string | null | undefined,
  timezone?: string | null,
): string | null {
  if (!expiresAt) return null;
  const when = new Date(expiresAt);
  if (Number.isNaN(when.getTime())) return null;
  // `formatToParts` + manual assembly, NOT a locale pattern: `en-GB` renders
  // September as `Sept`, and `en-US` renders `Sep 17`. Neither is `17 Sep`.
  const parts = new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    ...(timezone ? { timeZone: timezone } : {}),
  }).formatToParts(when);
  const day = parts.find((p) => p.type === 'day')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  if (!day || !month) return null;
  return `expires ${day} ${month}`;
}

/**
 * ROK-1479 D9 — `<t:EPOCH:t>`, Discord's short-time markup.
 *
 * DESCRIPTIONS AND FIELD VALUES ONLY. Discord renders the markup in those two
 * slots and nowhere else, and `applyEmbedChrome` THROWS if it reaches an author
 * line or a footer. That is why this is a SECOND formatter beside
 * {@link formatExpiryLabel} rather than an edit to it: that one is the footer
 * formatter and its "NEVER `<t:…>`" contract stands untouched.
 *
 * No timezone parameter, deliberately — Discord renders `<t:…>` in each
 * READER'S own zone, which is the entire point of using it for a 30-minute
 * clock that people in different zones have to act on within the hour.
 *
 * @param expiresAt - ISO instant, or null when nothing expires.
 * @returns `<t:1789043400:t>`, or null when there is no readable instant.
 */
export function formatNowExpiry(
  expiresAt: string | null | undefined,
): string | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime();
  if (Number.isNaN(ms)) return null;
  return `<t:${String(Math.floor(ms / 1000))}:t>`;
}
