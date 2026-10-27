/**
 * ROK-2022: where the calendar OAuth callback sends the browser.
 *
 * The start route takes `?return=<CalendarOAuthReturn>` — a named enum, never
 * a path or URL — and signs it into the state as `t`. Only a callback whose
 * state verified carries the target; every other landing (kill switch off,
 * bad state, …) keeps the legacy My Integrations path. Paths are fixed here,
 * so a browser can never steer the redirect off-site (L3).
 */
import { BadRequestException } from '@nestjs/common';
import {
  CalendarOAuthReturnSchema,
  type CalendarOAuthErrorCode,
  type CalendarOAuthReturn,
} from '@raid-ledger/contract';

/** The default landing. Calendars render on My Integrations (ROK-1780). */
export const CALENDARS_PAGE_PATH = '/profile/integrations';

/** The first-run wizard, reopened on its Calendar step. */
export const ONBOARDING_RESUME_PATH = '/onboarding?resume=calendar';

export interface CalendarCallbackResult {
  outcome: 'connected' | CalendarOAuthErrorCode;
  returnTarget?: CalendarOAuthReturn;
}

/** `?return=` on the start route: absent → undefined; unknown → 400. */
export function parseOAuthReturnQuery(
  raw: unknown,
): CalendarOAuthReturn | undefined {
  if (raw === undefined) return undefined;
  const parsed = CalendarOAuthReturnSchema.safeParse(raw);
  if (!parsed.success) throw new BadRequestException('invalid_return');
  return parsed.data;
}

/** The absolute 302 target for a finished callback. */
export function callbackLocation(
  clientUrl: string,
  provider: string,
  result: CalendarCallbackResult,
): string {
  const base = clientUrl.replace(/\/+$/, '');
  const qs =
    result.outcome === 'connected'
      ? `connected=${provider}`
      : `error=${result.outcome}`;
  if (result.returnTarget === 'onboarding') {
    return `${base}${ONBOARDING_RESUME_PATH}&${qs}`;
  }
  return `${base}${CALENDARS_PAGE_PATH}?${qs}`;
}
