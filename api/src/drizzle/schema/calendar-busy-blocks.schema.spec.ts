/**
 * ROK-1593 §6.4.2 — `calendar_busy_blocks` privacy guard.
 *
 * A busy block records only WHEN a user is busy. A text-ish column (title,
 * location, attendee, provider event id, iCalUID …) would let foreign calendar
 * content reach the DB, so the column set is pinned exactly and no column may
 * be a string type. Widening it needs a privacy review, not a test edit.
 */
import { getTableConfig } from 'drizzle-orm/pg-core';
import { calendarBusyBlocks } from './calendar-busy-blocks';

const ALLOWED_COLUMNS = [
  'all_day',
  'connection_id',
  'ends_at',
  'first_date',
  'id',
  'last_date',
  'starts_at',
  'user_id',
];

const STRING_SQL_TYPES = /^(text|varchar|char|character|json|jsonb|citext)/i;

describe('calendar_busy_blocks schema (ROK-1593 §6.4.2 privacy)', () => {
  const config = getTableConfig(calendarBusyBlocks);

  it('is the calendar_busy_blocks table', () => {
    expect(config.name).toBe('calendar_busy_blocks');
  });

  it('has exactly the allowed column set', () => {
    const names = config.columns.map((c) => c.name).sort();
    expect(names).toEqual(ALLOWED_COLUMNS);
  });

  it('has no text, varchar, char or json column', () => {
    // drizzle reports `date` columns as dataType 'string' — they are dates.
    const stringy = config.columns
      .filter((c) => c.getSQLType() !== 'date')
      .filter(
        (c) => c.dataType === 'string' || STRING_SQL_TYPES.test(c.getSQLType()),
      )
      .map((c) => `${c.name}:${c.getSQLType()}`);
    expect(stringy).toEqual([]);
  });

  it('cascades from both the connection and the user', () => {
    const fks = config.foreignKeys.map((fk) => ({
      cols: fk.reference().columns.map((c) => c.name),
      onDelete: fk.onDelete,
    }));
    expect(fks).toEqual(
      expect.arrayContaining([
        { cols: ['connection_id'], onDelete: 'cascade' },
        { cols: ['user_id'], onDelete: 'cascade' },
      ]),
    );
  });
});
