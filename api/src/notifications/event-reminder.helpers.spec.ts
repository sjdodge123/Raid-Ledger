import { buildReminderStrings } from './event-reminder.helpers';

/** 2026-11-13 20:00 UTC — 15:00 EST, 12:00 PST. */
const START = new Date('2026-11-13T20:00:00Z');

function reminderFor(timezone?: string, defaultTimezone?: string): string {
  return buildReminderStrings({
    title: 'Raid Night',
    startTime: START,
    minutesUntil: 15,
    ...(timezone !== undefined ? { timezone } : {}),
    ...(defaultTimezone !== undefined ? { defaultTimezone } : {}),
  }).messageText.replace(/\s/g, ' '); // ICU may emit U+202F before AM/PM
}

describe('buildReminderStrings — stored timezone validation', () => {
  it('formats the start time in a valid user timezone', () => {
    expect(reminderFor('America/New_York', 'UTC')).toContain('3:00 PM EST');
  });

  it('falls back to the default timezone when the stored one is not an IANA zone', () => {
    expect(() => reminderFor('Not/AZone', 'America/Los_Angeles')).not.toThrow();
    expect(reminderFor('Not/AZone', 'America/Los_Angeles')).toContain(
      '12:00 PM PST',
    );
  });

  it('falls back to UTC when both the stored and default timezones are invalid', () => {
    expect(() => reminderFor('Not/AZone', 'Also/Bogus')).not.toThrow();
    expect(reminderFor('Not/AZone', 'Also/Bogus')).toContain('8:00 PM UTC');
  });
});
