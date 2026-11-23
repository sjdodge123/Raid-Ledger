/**
 * ROK-2301: a poll opened from an ended event's follow-up prompt is titled
 * `<game> — Poll (after <event>)` on its Raid Ledger thread (120 code
 * points) and its Discord post (100). The event title is what gets cut; a
 * reschedule wins; a blank or gone source event falls back to the plain
 * `<game> — Poll`. Pure; the real-db read is the sync integration spec.
 */
import { pollPostTitle } from '../discord/hub-forum-discord-subject';
import { subjectPostTitle } from '../discord/hub-forum-discord-subject';
import type { PollSyncRow } from './poll-discussion.queries';
import { pollThreadTitle } from './poll-discussion.sync';
import { followupPollTitle, pollTitleWithin } from './poll-discussion.title';

const GAME = 'World of Warcraft: Forever';
const HEAD = `${GAME} — Poll (after `;

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
const rlTitle = (p: PollSyncRow) => pollTitleWithin(p, 120, pollThreadTitle);
const size = (text: string) => Array.from(text).length;

describe('follow-up poll thread title (ROK-2301)', () => {
  it('names the event the poll came after, on both sides', () => {
    const want = `${GAME} — Poll (after Thursday Raid)`;
    expect(rlTitle(followup('Thursday Raid'))).toBe(want);
    expect(pollPostTitle(followup('Thursday Raid'))).toBe(want);
  });

  it('trims the event title', () => {
    expect(rlTitle(followup('  Thursday Raid  '))).toBe(
      `${GAME} — Poll (after Thursday Raid)`,
    );
  });

  it('a reschedule (linked event) wins over a follow-up', () => {
    const both = followup('Thursday Raid', {
      linkedEventId: 9,
      linkedEventTitle: 'Friday Raid',
    });
    expect(rlTitle(both)).toBe('Reschedule: Friday Raid — Poll');
    expect(pollPostTitle(both)).toBe('Reschedule: Friday Raid — Poll');
  });

  it('a plain poll is unchanged', () => {
    expect(rlTitle(poll())).toBe(`${GAME} — Poll`);
    expect(pollPostTitle(poll())).toBe(`${GAME} — Poll`);
  });

  it('a blank or gone source event falls back to "<game> — Poll"', () => {
    expect(rlTitle(followup('   '))).toBe(`${GAME} — Poll`);
    expect(rlTitle(followup(null))).toBe(`${GAME} — Poll`);
    expect(pollPostTitle(followup(''))).toBe(`${GAME} — Poll`);
  });
});

describe('follow-up title limits (ROK-2301)', () => {
  const longEvent = `Thursday ${'Molten Core '.repeat(20)}Raid`;

  it('cuts the event title at 120 and keeps game, " — Poll" and the close', () => {
    const title = rlTitle(followup(longEvent));
    expect(size(title)).toBe(120);
    expect(title.startsWith(`${HEAD}Thursday Molten Core`)).toBe(true);
    expect(title.endsWith('…)')).toBe(true);
  });

  it('cuts the event title at 100 for the Discord post', () => {
    const name = pollPostTitle(followup(longEvent));
    expect(size(name)).toBeLessThanOrEqual(100);
    expect(name.startsWith(`${HEAD}Thursday Molten Core`)).toBe(true);
    expect(name.endsWith('…)')).toBe(true);
  });

  it('a game too long for "<game> — Poll (after …)" falls back to the plain cut', () => {
    const rlGame = 'G'.repeat(115);
    expect(rlTitle(followup('Raid', { gameName: rlGame }))).toBe(
      pollThreadTitle(rlGame),
    );
    const dcGame = 'G'.repeat(90);
    expect(pollPostTitle(followup('Raid', { gameName: dcGame }))).toBe(
      subjectPostTitle('poll', dcGame),
    );
  });

  it('cuts by code point, never splitting an astral character', () => {
    const title = followupPollTitle(GAME, '🐉'.repeat(200), 120);
    const room = 120 - size(HEAD) - 2;
    expect(title).toBe(`${HEAD}${'🐉'.repeat(room)}…)`);
  });

  it('a title that fits exactly is used whole, without an ellipsis', () => {
    const event = 'x'.repeat(120 - size(HEAD) - 1);
    expect(followupPollTitle(GAME, event, 120)).toBe(`${HEAD}${event})`);
  });
});
