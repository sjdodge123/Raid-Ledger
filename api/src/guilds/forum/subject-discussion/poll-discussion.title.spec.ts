/**
 * ROK-2315 (was ROK-2301): Discord's forum sidebar cuts post titles at about
 * 30 characters, so a poll title leads with what tells it apart. A follow-up
 * poll is `<event> — Follow-up poll`; a plain poll with a deadline is
 * `Poll · closes <date> — <game>`; without one it stays `<game> — Poll`; a
 * reschedule stays `Reschedule: <event> — Poll`. The Raid Ledger thread is
 * held to 120 code points, the Discord post to 100. Pure; the real-db read is
 * the sync integration spec.
 */
import { pollPostTitle } from '../discord/hub-forum-discord-subject';
import type { PollSyncRow } from './poll-discussion.queries';
import { pollThreadTitle } from './poll-discussion.sync';
import {
  deadlinePollTitle,
  followupPollTitle,
  pollTitleNeedsZone,
  pollTitleWithin,
} from './poll-discussion.title';

const GAME = 'World of Warcraft: Forever';
const TAIL = ' — Follow-up poll';
/** Thu 26 Nov 2026, 18:00 UTC — still Thursday in UTC and New York. */
const DEADLINE = new Date('2026-11-26T18:00:00Z');

function poll(over: Partial<PollSyncRow> = {}): PollSyncRow {
  return {
    matchId: 21,
    lineupId: 4,
    status: 'scheduling',
    lineupStatus: 'decided',
    phaseDeadline: null,
    linkedEventId: null,
    linkedEventTitle: null,
    followupOfEventTitle: null,
    guildId: 7,
    visibility: 'public',
    creatorId: 1,
    gameName: GAME,
    lineupTitle: 'Standalone Scheduling Poll',
    standalone: true,
    ...over,
  };
}

const followup = (title: string | null, over: Partial<PollSyncRow> = {}) =>
  poll({ followupOfEventTitle: title, ...over });
/** The Raid Ledger thread title, as `derived` builds it. */
const rlTitle = (p: PollSyncRow, zone: string | null = null) =>
  pollTitleWithin(p, 120, pollThreadTitle, zone);
const dcTitle = (p: PollSyncRow, zone: string | null = null) =>
  pollPostTitle(p, zone);
const size = (text: string) => Array.from(text).length;

describe('follow-up poll title (ROK-2315)', () => {
  it('leads with the event, on both sides', () => {
    const want = 'SM:GY + SM:Lib 5 man — Follow-up poll';
    expect(rlTitle(followup('SM:GY + SM:Lib 5 man'))).toBe(want);
    expect(dcTitle(followup('SM:GY + SM:Lib 5 man'))).toBe(want);
  });

  it('trims the event title', () => {
    expect(rlTitle(followup('  Thursday Raid  '))).toBe(
      'Thursday Raid — Follow-up poll',
    );
  });

  it('ignores a deadline', () => {
    const p = followup('Thursday Raid', { phaseDeadline: DEADLINE });
    expect(dcTitle(p)).toBe('Thursday Raid — Follow-up poll');
  });

  it('a blank or gone source event falls back to the plain title', () => {
    expect(rlTitle(followup('   '))).toBe(`${GAME} — Poll`);
    expect(rlTitle(followup(null))).toBe(`${GAME} — Poll`);
    expect(dcTitle(followup(''))).toBe(`${GAME} — Poll`);
  });
});

describe('reschedule poll title (unchanged)', () => {
  it('a reschedule (linked event) wins over a follow-up and a deadline', () => {
    const both = followup('Thursday Raid', {
      linkedEventId: 9,
      linkedEventTitle: 'Friday Raid',
      phaseDeadline: DEADLINE,
    });
    expect(rlTitle(both)).toBe('Reschedule: Friday Raid — Poll');
    expect(dcTitle(both)).toBe('Reschedule: Friday Raid — Poll');
  });
});

describe('plain poll title (ROK-2315)', () => {
  it('without a deadline stays "<game> — Poll"', () => {
    expect(rlTitle(poll())).toBe(`${GAME} — Poll`);
    expect(dcTitle(poll())).toBe(`${GAME} — Poll`);
  });

  it('with a deadline leads with the close date', () => {
    const p = poll({ phaseDeadline: DEADLINE });
    const want = `Poll · closes Thu 26 Nov — ${GAME}`;
    expect(rlTitle(p)).toBe(want);
    expect(dcTitle(p)).toBe(want);
  });

  it('reads the date in the community timezone', () => {
    const late = poll({ phaseDeadline: new Date('2026-11-27T02:00:00Z') });
    expect(dcTitle(late)).toBe(`Poll · closes Fri 27 Nov — ${GAME}`);
    expect(dcTitle(late, 'America/New_York')).toBe(
      `Poll · closes Thu 26 Nov — ${GAME}`,
    );
  });

  it('keeps the dated title once lock-in links the event it produced', () => {
    // findPollForSync nulls linkedEventTitle for the poll's own event, so
    // POLL_LOCKED_IN must not rename the post to "<game> — Poll".
    const locked = poll({
      linkedEventId: 5,
      linkedEventTitle: null,
      phaseDeadline: DEADLINE,
    });
    const want = `Poll · closes Thu 26 Nov — ${GAME}`;
    expect(rlTitle(locked)).toBe(want);
    expect(dcTitle(locked)).toBe(want);
    expect(pollTitleNeedsZone(locked)).toBe(true);
  });

  it('needs the zone only for the dated form', () => {
    expect(pollTitleNeedsZone(poll({ phaseDeadline: DEADLINE }))).toBe(true);
    expect(pollTitleNeedsZone(poll())).toBe(false);
    const resched = poll({
      linkedEventId: 9,
      linkedEventTitle: 'Friday Raid',
      phaseDeadline: DEADLINE,
    });
    expect(pollTitleNeedsZone(resched)).toBe(false);
    const fu = followup('Thursday Raid', { phaseDeadline: DEADLINE });
    expect(pollTitleNeedsZone(fu)).toBe(false);
  });

  it('a blank game reads "Scheduling"', () => {
    const p = poll({ phaseDeadline: DEADLINE, gameName: '  ' });
    expect(rlTitle(p)).toBe('Poll · closes Thu 26 Nov — Scheduling');
  });

  it('a long game is cut with an ellipsis, never the date', () => {
    const game = 'G'.repeat(200);
    const head = 'Poll · closes Thu 26 Nov — ';
    const rl = rlTitle(poll({ phaseDeadline: DEADLINE, gameName: game }));
    expect(rl).toBe(`${head}${'G'.repeat(120 - size(head) - 1)}…`);
    const dc = dcTitle(poll({ phaseDeadline: DEADLINE, gameName: game }));
    expect(dc).toBe(`${head}${'G'.repeat(100 - size(head) - 1)}…`);
  });
});

describe('follow-up title limits (ROK-2315)', () => {
  const longEvent = `Thursday ${'Molten Core '.repeat(20)}Raid`;

  it('cuts the event title at 120 and keeps the follow-up tail', () => {
    const title = rlTitle(followup(longEvent));
    const room = 120 - size(TAIL) - 1;
    const cut = Array.from(longEvent).slice(0, room).join('').trimEnd();
    expect(title).toBe(`${cut}…${TAIL}`);
    expect(size(title)).toBeLessThanOrEqual(120);
  });

  it('cuts the event title at 100 for the Discord post', () => {
    const name = dcTitle(followup(longEvent));
    const room = 100 - size(TAIL) - 1;
    const cut = Array.from(longEvent).slice(0, room).join('').trimEnd();
    expect(name).toBe(`${cut}…${TAIL}`);
    expect(name.length).toBeLessThanOrEqual(100);
  });

  it('cuts by code point, never splitting an astral character', () => {
    const title = followupPollTitle('🐉'.repeat(200), 120);
    const room = 120 - size(TAIL) - 1;
    expect(title).toBe(`${'🐉'.repeat(room)}…${TAIL}`);
  });

  it('keeps an emoji-heavy Discord name within 100 UTF-16 units', () => {
    const name = dcTitle(followup('🐉'.repeat(200)));
    // 100 → 82 dragons (182 units) → max 59 → 41 dragons: 82 + 1 + 17 = 100.
    expect(name).toBe(`${'🐉'.repeat(41)}…${TAIL}`);
    expect(name.length).toBeLessThanOrEqual(100);
  });

  it('a title that fits exactly is used whole, without an ellipsis', () => {
    const event = 'x'.repeat(120 - size(TAIL));
    expect(followupPollTitle(event, 120)).toBe(`${event}${TAIL}`);
  });

  it('null when not even one character of the event fits', () => {
    expect(followupPollTitle('Raid', size(TAIL))).toBeNull();
  });
});

describe('deadline title limits (ROK-2315)', () => {
  it('null when not even one character of the game fits', () => {
    const head = 'Poll · closes Thu 26 Nov — ';
    expect(deadlinePollTitle(GAME, 'Thu 26 Nov', size(head))).toBeNull();
  });

  it('a game that fits exactly is used whole', () => {
    const head = 'Poll · closes Thu 26 Nov — ';
    const game = 'g'.repeat(100 - size(head));
    expect(deadlinePollTitle(game, 'Thu 26 Nov', 100)).toBe(`${head}${game}`);
  });
});
