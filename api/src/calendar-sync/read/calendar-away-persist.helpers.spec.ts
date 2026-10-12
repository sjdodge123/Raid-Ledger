/**
 * ROK-1593 B3a — the PURE diff behind synced away days
 * (`planCalendarAbsenceWrites`). The DB half of `runCalendarDerive` is proven
 * by the B5 integration spec.
 *
 * Decision pinned here: a non-calendar (manual) row handed in by mistake is
 * IGNORED — never updated, never deleted — and does not stop the derived
 * range covering the same dates from being inserted as a calendar row.
 */
import {
  planCalendarAbsenceWrites,
  type ExistingAwayRow,
} from './calendar-away-persist.helpers';
import type { DerivedAwayRange } from './calendar-away-derive.helpers';

function existingRow(
  id: number,
  startDate: string,
  endDate: string,
  calendarConnectionId: number | null = 7,
  source = 'calendar',
): ExistingAwayRow {
  return { id, source, startDate, endDate, calendarConnectionId };
}

function derived(
  startDate: string,
  endDate: string,
  calendarConnectionId = 7,
): DerivedAwayRange {
  return { startDate, endDate, calendarConnectionId };
}

describe('planCalendarAbsenceWrites', () => {
  it('keeps unchanged ranges with no write at all (stable ids)', () => {
    const plan = planCalendarAbsenceWrites(
      [
        existingRow(11, '2026-10-20', '2026-10-20'),
        existingRow(12, '2026-10-23', '2026-10-25'),
      ],
      [
        derived('2026-10-20', '2026-10-20'),
        derived('2026-10-23', '2026-10-25'),
      ],
    );

    expect(plan).toEqual({ insert: [], update: [], deleteIds: [] });
  });

  it('deletes a range that is no longer derived and keeps the rest', () => {
    const plan = planCalendarAbsenceWrites(
      [
        existingRow(11, '2026-10-20', '2026-10-20'),
        existingRow(12, '2026-10-23', '2026-10-25'),
      ],
      [derived('2026-10-23', '2026-10-25')],
    );

    expect(plan).toEqual({ insert: [], update: [], deleteIds: [11] });
  });

  it('inserts a newly derived range with its attributed connection', () => {
    const plan = planCalendarAbsenceWrites(
      [existingRow(11, '2026-10-20', '2026-10-20')],
      [
        derived('2026-10-20', '2026-10-20'),
        derived('2026-10-27', '2026-10-28', 9),
      ],
    );

    expect(plan).toEqual({
      insert: [derived('2026-10-27', '2026-10-28', 9)],
      update: [],
      deleteIds: [],
    });
  });

  it('a range that grew is a delete of the old row plus an insert', () => {
    const plan = planCalendarAbsenceWrites(
      [existingRow(11, '2026-10-20', '2026-10-21')],
      [derived('2026-10-20', '2026-10-22')],
    );

    expect(plan).toEqual({
      insert: [derived('2026-10-20', '2026-10-22')],
      update: [],
      deleteIds: [11],
    });
  });

  it('an attribution change updates the connection id in place (Q16)', () => {
    const plan = planCalendarAbsenceWrites(
      [existingRow(11, '2026-10-20', '2026-10-22', 3)],
      [derived('2026-10-20', '2026-10-22', 8)],
    );

    expect(plan).toEqual({
      insert: [],
      update: [{ id: 11, calendarConnectionId: 8 }],
      deleteIds: [],
    });
  });

  it('empty derived set deletes every existing calendar row', () => {
    const plan = planCalendarAbsenceWrites(
      [
        existingRow(11, '2026-10-20', '2026-10-20'),
        existingRow(12, '2026-10-23', '2026-10-25', 4),
      ],
      [],
    );

    expect(plan).toEqual({ insert: [], update: [], deleteIds: [11, 12] });
  });

  it('never puts a manual row in the write set, even on an exact range match', () => {
    const manual = existingRow(21, '2026-10-20', '2026-10-20', null, 'manual');
    const otherManual = existingRow(
      22,
      '2026-11-01',
      '2026-11-03',
      null,
      'manual',
    );

    const plan = planCalendarAbsenceWrites(
      [manual, otherManual],
      [derived('2026-10-20', '2026-10-20')],
    );

    expect(plan.deleteIds).not.toContain(21);
    expect(plan.deleteIds).not.toContain(22);
    expect(plan.update.map((u) => u.id)).toEqual([]);
    expect(plan).toEqual({
      insert: [derived('2026-10-20', '2026-10-20')],
      update: [],
      deleteIds: [],
    });
  });

  it('deletes a duplicate calendar row for an already-matched range', () => {
    const plan = planCalendarAbsenceWrites(
      [
        existingRow(11, '2026-10-20', '2026-10-20'),
        existingRow(12, '2026-10-20', '2026-10-20'),
      ],
      [derived('2026-10-20', '2026-10-20')],
    );

    expect(plan).toEqual({ insert: [], update: [], deleteIds: [12] });
  });

  it('combines insert, update and delete in one plan', () => {
    const plan = planCalendarAbsenceWrites(
      [
        existingRow(11, '2026-10-20', '2026-10-20', 3),
        existingRow(12, '2026-10-23', '2026-10-25'),
        existingRow(13, '2026-10-30', '2026-10-30'),
      ],
      [
        derived('2026-10-20', '2026-10-20', 2),
        derived('2026-10-23', '2026-10-25'),
        derived('2026-11-02', '2026-11-02', 5),
      ],
    );

    expect(plan).toEqual({
      insert: [derived('2026-11-02', '2026-11-02', 5)],
      update: [{ id: 11, calendarConnectionId: 2 }],
      deleteIds: [13],
    });
  });
});
