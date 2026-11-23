/**
 * ROK-2295 — a poll thread is titled by its goal: a reschedule poll
 * `Reschedule: <event title>`, any other poll its game; the synthetic
 * standalone storage title never surfaces. Pure; the real-db lifecycle is
 * the integration spec.
 */
import { subjectPostTitle } from '../discord/hub-forum-discord-subject';
import type { PollSyncRow } from './poll-discussion.queries';
import { pollSubjectTitle, pollThreadTitle } from './poll-discussion.sync';

const STORAGE_TITLE = 'Standalone Scheduling Poll';

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
    gameName: 'World of Warcraft: Forever',
    lineupTitle: STORAGE_TITLE,
    standalone: true,
    ...over,
  };
}

const resched = (title: string) =>
  poll({ linkedEventId: 9, linkedEventTitle: title });

describe('pollSubjectTitle (ROK-2295 goal title)', () => {
  it('a reschedule poll is "Reschedule: <event title>"', () => {
    expect(pollSubjectTitle(resched('Thursday Raid'))).toBe(
      'Reschedule: Thursday Raid',
    );
  });

  it('a standalone poll is its game, never the storage title', () => {
    expect(pollSubjectTitle(poll())).toBe('World of Warcraft: Forever');
    expect(pollThreadTitle(pollSubjectTitle(poll()))).not.toContain(
      STORAGE_TITLE,
    );
  });

  it('a lineup-derived poll is its game', () => {
    expect(pollSubjectTitle(poll({ standalone: false }))).toBe(
      'World of Warcraft: Forever',
    );
  });

  it('a poll that PRODUCED its event (no reschedule title) stays its game', () => {
    const produced = poll({ status: 'scheduled', linkedEventId: 9 });
    expect(pollSubjectTitle(produced)).toBe('World of Warcraft: Forever');
  });

  it('a blank event title falls back to the game', () => {
    expect(pollSubjectTitle(resched('   '))).toBe('World of Warcraft: Forever');
  });
});

describe('goal title limits', () => {
  const long = `Thursday ${'Molten Core '.repeat(20)}Raid`;

  it('the Discord post name is ≤100 and keeps the suffix', () => {
    const name = subjectPostTitle('poll', pollSubjectTitle(resched(long)));
    expect(Array.from(name).length).toBeLessThanOrEqual(100);
    expect(name.startsWith('Reschedule: Thursday Molten Core')).toBe(true);
    expect(name.endsWith(' — Poll')).toBe(true);
  });

  it('the RL thread title is ≤120 and keeps the suffix', () => {
    const title = pollThreadTitle(pollSubjectTitle(resched(long)));
    expect(Array.from(title).length).toBeLessThanOrEqual(120);
    expect(title.startsWith('Reschedule: Thursday Molten Core')).toBe(true);
    expect(title.endsWith(' — Poll')).toBe(true);
  });

  it('a short goal is used whole', () => {
    expect(pollThreadTitle(pollSubjectTitle(resched('Thursday Raid')))).toBe(
      'Reschedule: Thursday Raid — Poll',
    );
    expect(subjectPostTitle('poll', pollSubjectTitle(poll()))).toBe(
      'World of Warcraft: Forever — Poll',
    );
  });
});
