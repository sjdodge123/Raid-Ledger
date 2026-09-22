import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  UNANIMOUS_SLOTS_QUERY,
  buildUnanimousCopy,
  buildUnanimousNotification,
  unanimousDedupKey,
  unanimousReminderWindow,
} from './scheduling-unanimous.helpers';
import type { UnanimousSlotRow } from './scheduling-unanimous.helpers';

/** Render a drizzle `sql` template the way the driver would see it. */
function render(query: SQL): { text: string; params: unknown[] } {
  const { sql: text, params } = new PgDialect().sqlToQuery(query);
  return { text, params };
}

/** 2030-05-17T20:00:00Z — a fixed future Friday. */
const PROPOSED_TIME = '2030-05-17T20:00:00.000Z';
const PROPOSED_EPOCH = 1905278400;

function makeRow(overrides: Partial<UnanimousSlotRow> = {}): UnanimousSlotRow {
  return {
    matchId: 9,
    slotId: 42,
    lineupId: 4,
    creatorId: 77,
    gameName: 'Valheim',
    proposedTime: PROPOSED_TIME,
    memberCount: 3,
    ...overrides,
  };
}

describe('scheduling-unanimous.helpers', () => {
  describe('buildUnanimousCopy', () => {
    it('U1: names the game in the title and the member count + Discord timestamp in the message', () => {
      const copy = buildUnanimousCopy('Valheim', 3, PROPOSED_TIME);

      expect(copy.title).toBe("Everyone's in for Valheim");
      expect(copy.message).toContain('All 3 members');
      expect(copy.message).toContain(`<t:${PROPOSED_EPOCH}:f>`);
    });

    it('U1b: reads the epoch as UTC even for a naive postgres timestamp string', () => {
      const copy = buildUnanimousCopy('Valheim', 2, '2030-05-17 20:00:00.000');

      expect(copy.message).toContain(`<t:${PROPOSED_EPOCH}:f>`);
    });
  });

  describe('UNANIMOUS_SLOTS_QUERY', () => {
    it('U2: a one-member match is never unanimous — the member-count floor is > 1', () => {
      const { text } = render(UNANIMOUS_SLOTS_QUERY(null));

      expect(text.replace(/\s+/g, ' ')).toContain('mem.n > 1');
    });

    it('gates on a scheduling match and a future time', () => {
      const text = render(UNANIMOUS_SLOTS_QUERY(null)).text.replace(
        /\s+/g,
        ' ',
      );

      expect(text).toContain("m.status = 'scheduling'");
      expect(text).toContain('s.proposed_time > NOW()');
    });

    it('gates on the LINEUP lifecycle too — archived, past-deadline and locked-in polls are excluded', () => {
      const text = render(UNANIMOUS_SLOTS_QUERY(null)).text.replace(
        /\s+/g,
        ' ',
      );

      // The lineup-phase job archives the LINEUP and leaves the match on
      // 'scheduling' (scheduling-guard.helpers.ts), so the match gate alone
      // lets an expired/closed poll DM "Lock it in".
      expect(text).toContain("l.status <> 'archived'");
      // NULL phase_deadline (standalone polls) must still pass.
      expect(text).toContain(
        '(l.phase_deadline IS NULL OR l.phase_deadline > NOW())',
      );
      expect(text).toContain('m.linked_event_id IS NULL');
    });

    it('orders the rows by earliest proposed time so the per-match cap is deterministic', () => {
      const text = render(UNANIMOUS_SLOTS_QUERY(null)).text.replace(
        /\s+/g,
        ' ',
      );

      expect(text).toContain('ORDER BY s.proposed_time ASC, s.id ASC');
    });

    it('requires that NO member lacks a yes vote on the slot (strict 100%)', () => {
      const text = render(UNANIMOUS_SLOTS_QUERY(null)).text.replace(
        /\s+/g,
        ' ',
      );

      expect(text).toContain('NOT EXISTS');
      expect(text).toContain("v.stance = 'yes'");
      // The count-comparison form is wrong (a non-member can vote first).
      expect(text).not.toContain('COUNT(v.');
    });

    it('emits proposed_time as an explicit UTC ISO string, never a naive timestamp', () => {
      const text = render(UNANIMOUS_SLOTS_QUERY(null)).text.replace(
        /\s+/g,
        ' ',
      );

      expect(text).toContain(
        `to_char(s.proposed_time, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "proposedTime"`,
      );
    });

    it('scopes to one match when given a matchId, and binds it as a parameter', () => {
      const { text, params } = render(UNANIMOUS_SLOTS_QUERY(9));

      expect(text.replace(/\s+/g, ' ')).toContain('AND m.id = $');
      expect(params).toContain(9);
    });

    it('scans every match when matchId is null', () => {
      const { text, params } = render(UNANIMOUS_SLOTS_QUERY(null));

      expect(text).not.toContain('m.id = $');
      expect(params).toHaveLength(0);
    });
  });

  describe('keys', () => {
    it('U3: the dedup key is per poll per time', () => {
      expect(unanimousDedupKey(7, 42)).toBe('sched-poll-unanimous:7:42');
    });

    it('U3: the rate-limit bucket collides with neither the nudge nor the rally bucket', () => {
      const window = unanimousReminderWindow(7, 42);

      expect(window).toBe('unanimous-7-42');
      expect(window).not.toBe('poll-7');
      expect(window).not.toBe('rally-7');
    });
  });

  describe('buildUnanimousNotification', () => {
    it('U4: addresses the creator with the lock-capable community_lineup payload', () => {
      const input = buildUnanimousNotification(makeRow(), 'America/New_York');

      expect(input.userId).toBe(77);
      expect(input.type).toBe('community_lineup');
      expect(input.title).toBe("Everyone's in for Valheim");
      expect(input.payload).toMatchObject({
        subtype: 'scheduling_poll_unanimous_time',
        reminderWindow: 'unanimous-9-42',
        lineupId: 4,
        matchId: 9,
        slotId: 42,
        gameName: 'Valheim',
      });
    });

    it('U4: carries a Lock button label rendered in the community timezone', () => {
      const input = buildUnanimousNotification(makeRow(), 'America/New_York');

      // 2030-05-17T20:00Z is Fri 4:00 PM in New York.
      expect(input.payload?.lockLabel).toBe('Lock in Fri 4:00 PM');
    });

    it('U4: falls back to UTC for a corrupt timezone rather than throwing', () => {
      const input = buildUnanimousNotification(makeRow(), 'Not/AZone');

      expect(input.payload?.lockLabel).toBe('Lock in Fri 8:00 PM');
    });
  });
});
