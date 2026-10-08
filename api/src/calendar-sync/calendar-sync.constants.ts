/**
 * Calendar Sync constants (ROK-1591, epic ROK-669).
 *
 * Queue names are added by the stories that create the queues, and must be
 * appended to `ALL_QUEUE_NAMES` (`queue/queue-registry.ts`) when they are.
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
