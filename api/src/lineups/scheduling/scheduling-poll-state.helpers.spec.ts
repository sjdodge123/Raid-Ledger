/**
 * Unit coverage for the poll-page terminal-state helpers (ROK-1545 review).
 *
 * F3 — the locked-in fallback must name the WINNER. When the linked event row
 * is gone (or was never created) the winning time comes from the shared
 * comparator, which needs real vote counts; with a flat `voteCount: 0` it
 * degenerates to time-ascending and names the earliest slot instead.
 * F8 — the write path must refuse a poll the read path already calls terminal.
 */
import { BadRequestException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { resolvePollTerminalState } from './scheduling-poll-state.helpers';
import { assertPollOpen } from './scheduling-guard.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * A db handle that must never be touched: with no linked event and a terminal
 * status, neither the event lookup nor the eligibility probe should run.
 */
const unusedDb = new Proxy(
  {},
  {
    get() {
      throw new Error('the fallback path must not query the database');
    },
  },
) as Db;

const EARLY = new Date('2030-06-10T18:00:00.000Z');
const LATE = new Date('2030-06-10T21:00:00.000Z');

describe('resolvePollTerminalState — locked-in fallback (ROK-1545 F3)', () => {
  const slots = [
    { id: 1, proposedTime: EARLY },
    { id: 2, proposedTime: LATE },
  ];

  it('names the top-voted slot, not the earliest one', async () => {
    const state = await resolvePollTerminalState(
      unusedDb,
      { status: 'scheduled', linkedEventId: null },
      { id: 7 },
      slots,
      null,
      [{ slotId: 2 }, { slotId: 2 }, { slotId: 1 }],
    );
    expect(state.pollStatus).toBe('locked_in');
    expect(state.lockedInTime).toBe(LATE.toISOString());
  });

  it('falls back to the earliest slot only when the vote counts tie', async () => {
    const state = await resolvePollTerminalState(
      unusedDb,
      { status: 'scheduled', linkedEventId: null },
      { id: 7 },
      slots,
      null,
      [{ slotId: 1 }, { slotId: 2 }],
    );
    expect(state.lockedInTime).toBe(EARLY.toISOString());
  });

  it('never names a slot whose only answers are `no` (ROK-1617)', async () => {
    const state = await resolvePollTerminalState(
      unusedDb,
      { status: 'scheduled', linkedEventId: null },
      { id: 7 },
      [{ id: 2, proposedTime: LATE }],
      null,
      [
        { slotId: 2, stance: 'no' },
        { slotId: 2, stance: 'no' },
      ],
    );
    expect(state.pollStatus).toBe('locked_in');
    expect(state.lockedInTime).toBeNull();
  });

  it('skips a rejected slot in favour of one somebody said yes to', async () => {
    const state = await resolvePollTerminalState(
      unusedDb,
      { status: 'scheduled', linkedEventId: null },
      { id: 7 },
      slots,
      null,
      [
        { slotId: 1, stance: 'no' },
        { slotId: 1, stance: 'no' },
        { slotId: 2, stance: 'yes' },
      ],
    );
    expect(state.lockedInTime).toBe(LATE.toISOString());
  });

  it('reports no locked-in time when the poll has no slots', async () => {
    const state = await resolvePollTerminalState(
      unusedDb,
      { status: 'scheduled', linkedEventId: null },
      { id: 7 },
      [],
      null,
      [],
    );
    expect(state.lockedInTime).toBeNull();
  });
});

describe('assertPollOpen (ROK-1545 F8)', () => {
  const past = new Date('2020-01-01T00:00:00.000Z');
  const future = new Date('2999-01-01T00:00:00.000Z');

  it('refuses a write to an EXPIRED poll the match status still calls schedulable', () => {
    expect(() =>
      assertPollOpen(
        { status: 'scheduling', linkedEventId: null },
        { status: 'archived', phaseDeadline: null },
      ),
    ).toThrow(BadRequestException);
  });

  it('refuses a write once the phase deadline has passed', () => {
    expect(() =>
      assertPollOpen(
        { status: 'scheduling', linkedEventId: null },
        { status: 'decided', phaseDeadline: past },
      ),
    ).toThrow(BadRequestException);
  });

  it('leaves an OPEN poll alone', () => {
    expect(() =>
      assertPollOpen(
        { status: 'scheduling', linkedEventId: null },
        { status: 'decided', phaseDeadline: future },
      ),
    ).not.toThrow();
  });

  it('refuses a write to a poll that already locked in', () => {
    expect(() =>
      assertPollOpen(
        { status: 'scheduled', linkedEventId: 314 },
        { status: 'decided', phaseDeadline: future },
      ),
    ).toThrow(BadRequestException);
  });
});
