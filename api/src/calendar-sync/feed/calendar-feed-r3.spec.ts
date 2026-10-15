/**
 * ROK-1599 R3: a user who subscribes their read-connected Google calendar to
 * their own Raid Ledger feed must not see those events come back as foreign
 * busy time. Google surfaces the feed VEVENT's UID as `iCalUID`.
 */
import { normalizeGoogleEvent } from '../providers/google/google-calendar-read.helpers';
import { deriveInstanceId } from '../providers/rl-copy-id.helpers';
import { isOwnCopy } from '../read/calendar-read-normalize.helpers';
import { buildFeedCalendar } from './calendar-feed-content.helpers';
import { serializeIcsCalendar } from './ics-serialize.helpers';

const CLIENT_URL = 'https://raid.example.test';
const OURS = deriveInstanceId('raid.example.test');

function feedUid(): string {
  const ics = serializeIcsCalendar(
    buildFeedCalendar(
      [
        {
          eventId: 42,
          title: 'Raid Night',
          start: new Date('2026-10-20T19:00:00.000Z'),
          end: new Date('2026-10-20T22:00:00.000Z'),
          tentative: false,
          benched: false,
        },
      ],
      {
        clientUrl: CLIENT_URL,
        userId: 7,
        now: new Date('2026-10-15T00:00:00Z'),
      },
    ),
  );
  const uid = /^UID:(.+)$/m.exec(ics)?.[1]?.trim();
  if (!uid) throw new Error('feed has no UID line');
  return uid;
}

const subscribedItem = (iCalUID: string) => ({
  status: 'confirmed',
  iCalUID,
  start: { dateTime: '2026-10-20T19:00:00Z' },
  end: { dateTime: '2026-10-20T22:00:00Z' },
});

describe('R3 — a subscribed feed event reads as our own copy', () => {
  it('drops the event when read for this instance', () => {
    expect(normalizeGoogleEvent(subscribedItem(feedUid()), OURS)).toBeNull();
  });

  it('keeps it with ourId set when no instance is given, and isOwnCopy agrees', () => {
    const uid = feedUid();
    const block = normalizeGoogleEvent(subscribedItem(uid), null);
    expect(block?.ourId).toBe(uid);
    expect(block && isOwnCopy(block, OURS)).toBe(true);
  });

  it('leaves a non-copy iCalUID alone (stays foreign busy time)', () => {
    const block = normalizeGoogleEvent(
      subscribedItem('fixture-uid-01@example.test'),
      OURS,
    );
    expect(block).not.toBeNull();
    expect(block?.ourId).toBeUndefined();
  });

  it('prefers the write-path rlCopyId over iCalUID', () => {
    const uid = feedUid();
    const block = normalizeGoogleEvent(
      {
        ...subscribedItem('abc@google.com'),
        extendedProperties: { private: { rlCopyId: uid } },
      },
      null,
    );
    expect(block?.ourId).toBe(uid);
  });
});
