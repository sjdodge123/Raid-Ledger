/**
 * ROK-2208 §5.7 — the pure event-post mapping: the operator-approved dated
 * title ("<event> — Sat 22 Nov", ROK-2226 mockup), the root text's absolute
 * event link, and the read-only test that keeps a closed thread off Discord.
 */
import { DISCORD_THREAD_NAME_MAX } from '../../../discord-bot/lfg-board/lfg-board.constants';
import {
  eventPostBody,
  eventPostDate,
  eventPostTitle,
  eventThreadReadOnly,
} from './hub-forum-discord-event-outbound';

/** Sat 22 Nov 2025, 23:30 UTC — Sunday already in Sydney. */
const START = new Date('2025-11-22T23:30:00Z');

describe('eventPostDate', () => {
  it('formats the start as "<weekday> <day> <month>" in the community zone', () => {
    expect(eventPostDate(START, 'UTC')).toBe('Sat 22 Nov');
    expect(eventPostDate(START, 'Australia/Sydney')).toBe('Sun 23 Nov');
  });

  it('falls back to UTC when the zone is unset or bogus', () => {
    expect(eventPostDate(START, null)).toBe('Sat 22 Nov');
    expect(eventPostDate(START, 'Not/AZone')).toBe('Sat 22 Nov');
  });
});

describe('eventPostTitle', () => {
  it('is "<event title> — <short date>"', () => {
    expect(eventPostTitle('  Molten Core ', START, 'UTC')).toBe(
      'Molten Core — Sat 22 Nov',
    );
  });

  it('cuts a long title to 100 chars and keeps the date suffix', () => {
    const name = eventPostTitle('Raid '.repeat(40), START, 'UTC');
    expect(name.length).toBeLessThanOrEqual(DISCORD_THREAD_NAME_MAX);
    expect(name.endsWith(' — Sat 22 Nov')).toBe(true);
    expect(name.startsWith('Raid Raid')).toBe(true);
  });

  it('never leaves the title part empty', () => {
    expect(eventPostTitle('   ', START, 'UTC')).toBe('Event — Sat 22 Nov');
  });
});

describe('eventPostBody', () => {
  const ROOT = 'Discussion for **MC**. [Open the event](/events/9)';

  it('puts root-relative links on the client URL', () => {
    expect(eventPostBody(ROOT, 'https://rl.example/')).toBe(
      'Discussion for **MC**. [Open the event](https://rl.example/events/9)',
    );
  });

  it('leaves the text alone when the client URL is not absolute', () => {
    expect(eventPostBody(ROOT, '')).toBe(ROOT);
  });
});

describe('eventThreadReadOnly (§5.7 item 5)', () => {
  const now = new Date('2025-11-23T12:00:00Z');
  const open = { writeClosesAt: new Date('2025-11-24T00:00:00Z') };

  it('is writable before write_closes_at while attached', () => {
    expect(eventThreadReadOnly({ ...open, eventDetachedAt: null }, now)).toBe(
      false,
    );
  });

  it('is read-only once write_closes_at has passed', () => {
    const closed = { writeClosesAt: now, eventDetachedAt: null };
    expect(eventThreadReadOnly(closed, now)).toBe(true);
  });

  it('is read-only once detached, whatever the deadline', () => {
    expect(eventThreadReadOnly({ ...open, eventDetachedAt: now }, now)).toBe(
      true,
    );
  });
});
