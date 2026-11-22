/** ROK-2293: `activated_at` re-stamp helpers. Real-DB behaviour lives in event-reminder.fresh-signup.integration.spec.ts. */
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  activatedAtOnReactivation,
  activatedAtPatch,
  isActiveSignupStatus,
} from './signup-activated-at.helpers';
import { buildReactivationFields } from './signups-signup.helpers';
import { buildUpdateSet } from '../discord-bot/listeners/reschedule-roster.handlers';

const dialect = new PgDialect();
const render = (x: unknown) =>
  dialect.sqlToQuery(x as Parameters<PgDialect['sqlToQuery']>[0]);
/** NOW_UTC, not bare now() — session-zone independent (ROK-2293 review). */
const STAMP = "(NOW() AT TIME ZONE 'UTC')";

describe('activatedAtOnReactivation (ROK-2293)', () => {
  const q = render(activatedAtOnReactivation());

  it('stamps the UTC wall clock only when the pre-update status is inactive', () => {
    expect(q.sql).toBe(
      `CASE WHEN "event_signups"."status" in ($1, $2, $3) THEN ${STAMP} ELSE "event_signups"."activated_at" END`,
    );
    expect(q.params).toEqual(['roached_out', 'departed', 'declined']);
  });
});

describe('activatedAtPatch', () => {
  it.each(['signed_up', 'tentative'])('re-stamps for active %s', (s) => {
    expect(isActiveSignupStatus(s)).toBe(true);
    const patch = activatedAtPatch(s);
    expect(patch.activatedAt && render(patch.activatedAt).sql).toContain(
      `THEN ${STAMP} ELSE`,
    );
  });

  it.each(['declined', 'roached_out', 'departed'])('is empty for %s', (s) => {
    expect(activatedAtPatch(s)).toEqual({});
  });
});

describe('reactivation paths set activatedAt', () => {
  it('buildReactivationFields stamps the current time', () => {
    const before = Date.now();
    const fields = buildReactivationFields(
      { note: null } as Parameters<typeof buildReactivationFields>[0],
      undefined,
      false,
    );
    expect(fields.activatedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(fields.status).toBe('signed_up');
  });

  it('reschedule buildUpdateSet uses the conditional re-stamp', () => {
    const set = buildUpdateSet({ signupStatus: 'tentative' });
    expect(render(set.activatedAt).sql).toContain(`THEN ${STAMP} ELSE`);
  });
});
