/**
 * Calendar Sync constants (ROK-1591, epic ROK-669).
 *
 * Queue names must be appended to `ALL_QUEUE_NAMES` (`queue/queue-registry.ts`).
 */
import {
  CALENDAR_LOOK_AHEAD_WEEKS,
  CalendarProviderSchema,
} from '@raid-ledger/contract';
import type { CalendarOAuthProvider } from '../settings/settings-calendar-sync.helpers';

/** Fixed read look-ahead window (operator decision 2026-09-16, Q8). */
export const LOOK_AHEAD_DAYS = CALENDAR_LOOK_AHEAD_WEEKS * 7;

/** Every provider the contract knows, in display order. */
export const CALENDAR_PROVIDERS = CalendarProviderSchema.options;

/** Providers connected through an admin-configured OAuth client. */
export const CALENDAR_OAUTH_PROVIDERS: readonly CalendarOAuthProvider[] = [
  'google',
  'microsoft',
];

/**
 * Path of a provider's OAuth callback as the browser sees it (nginx strips
 * the `/api` prefix before the request reaches Nest). The route itself is
 * ROK-1592's; the admin page shows this so the console entry matches.
 */
export function oauthCallbackPath(provider: CalendarOAuthProvider): string {
  return `/api/calendar-sync/oauth/${provider}/callback`;
}

/**
 * ROK-1593 D16: emitted by `GameTimeService.saveTemplate` after the save
 * commits; `CalendarTemplateSavedListener` re-derives the user's away days
 * (Rule B reads the template). Payload `{ userId }`.
 */
export const GAME_TIME_TEMPLATE_SAVED_EVENT = 'game-time.template-saved';

/** ROK-1596 D3: the single write queue (reconcile, write-off, disconnect). */
export const CALENDAR_WRITE_QUEUE = 'calendar-write';

/** Debounce for `reconcile` so a signup + auto-allocation burst writes once. */
export const WRITE_DEBOUNCE_MS = 5000;

/*
 * Fixed job ids. BullMQ 6 rejects a custom id holding ':' unless it splits
 * into exactly 3 parts ('Custom Id cannot contain :'), so the spec's
 * `cal-write:<conn>:<event>:<user>` form is spelled with '-' instead.
 */
export const reconcileJobId = (conn: number, event: number, user: number) =>
  `cal-write-${conn}-${event}-${user}`;
export const writeOffJobId = (conn: number) => `cal-writeoff-${conn}`;
export const disconnectJobId = (conn: number) => `cal-disconnect-${conn}`;
/** The one follow-up queued while the plain-id job is ACTIVE (D3). */
export const rerunJobId = (jobId: string) => `${jobId}-rerun`;

/** ROK-1593 D-R5: the read queue (sync now; PR-B adds `derive`). */
export const CALENDAR_READ_QUEUE = 'calendar-read';
export const readSyncJobId = (conn: number) => `cal-read-${conn}`;
/** PR-B (D9): one derive per user. Unused until the derive job lands. */
export const deriveJobId = (user: number) => `cal-derive-${user}`;
