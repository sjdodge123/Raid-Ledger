/**
 * ROK-1422 — the signup-confirmation replies ("You're signed up for **X**!")
 * must carry the event's start time so the attendee sees WHEN right after
 * committing. Pins the suffix helper the two exact-symptom handlers append:
 * exact `<t:EPOCH:F>` token for a valid start, and the '' guard for
 * missing/invalid starts (a malformed event never breaks the reply).
 */
import { signupTimeSuffix } from './signup-event-time.helpers';

describe('signupTimeSuffix (ROK-1422 confirmation time)', () => {
  // Fixed start (2026-08-15T18:30:00Z) so the token is deterministic.
  const START = new Date(1_786_559_400 * 1000);
  const END = new Date(1_786_566_600 * 1000);

  it('renders the event start as an exact " — <t:EPOCH:F>" suffix', () => {
    expect(signupTimeSuffix({ duration: [START, END] })).toBe(
      ' — <t:1786559400:F>',
    );
  });

  it('returns empty string when duration is missing', () => {
    expect(
      signupTimeSuffix({ duration: null as unknown as [Date, Date] }),
    ).toBe('');
  });

  it('returns empty string when the start is an invalid Date', () => {
    expect(signupTimeSuffix({ duration: [new Date('not-a-date'), END] })).toBe(
      '',
    );
  });
});
