/**
 * ROK-2272 S10 — pure rules for non-hub poll / lineup planning posts.
 */
import type { LineupSyncRow } from '../subject-discussion/lineup-discussion.queries';
import type { PollSyncRow } from '../subject-discussion/poll-discussion.queries';
import {
  lineupEligible,
  lineupOnPlanningPath,
  planningSubjectBody,
  pollEligible,
  pollOnPlanningPath,
} from './event-planning-posts.subjects.rules';

const NOW = new Date('2026-11-20T12:00:00Z');

function poll(over: Partial<PollSyncRow> = {}): PollSyncRow {
  return {
    matchId: 7,
    lineupId: 3,
    status: 'scheduling',
    lineupStatus: 'decided',
    phaseDeadline: null,
    linkedEventId: null,
    guildId: null,
    visibility: 'public',
    creatorId: 1,
    gameName: 'Valheim',
    lineupTitle: 'Friday raid',
    standalone: true,
    ...over,
  };
}

function lineup(over: Partial<LineupSyncRow> = {}): LineupSyncRow {
  return {
    lineupId: 3,
    title: 'November lineup',
    status: 'voting',
    guildId: null,
    visibility: 'public',
    creatorId: 1,
    standalone: false,
    ...over,
  };
}

describe('pollEligible', () => {
  it('accepts an open, public, non-hub poll', () => {
    expect(pollEligible(poll(), NOW)).toBe(true);
  });

  it.each<[string, Partial<PollSyncRow>]>([
    ['hub-tagged', { guildId: 5 }],
    ['private', { visibility: 'private' }],
    ['locked in', { status: 'scheduled' }],
    ['cancelled', { status: 'archived' }],
    ['still a suggestion', { status: 'suggested' }],
    ['past its deadline', { phaseDeadline: new Date(NOW.getTime() - 1000) }],
    ['on an archived lineup', { lineupStatus: 'archived' }],
  ])('refuses a %s poll', (_, over) => {
    expect(pollEligible(poll(over), NOW)).toBe(false);
  });

  it('keeps a reschedule poll open past its lineup deadline', () => {
    const p = poll({ linkedEventId: 9, phaseDeadline: new Date(0) });
    expect(pollEligible(p, NOW)).toBe(true);
  });
});

describe('pollOnPlanningPath', () => {
  it('drops a poll that became hub-tagged or private', () => {
    expect(pollOnPlanningPath(poll())).toBe(true);
    expect(pollOnPlanningPath(poll({ guildId: 2 }))).toBe(false);
    expect(pollOnPlanningPath(poll({ visibility: 'private' }))).toBe(false);
  });
});

describe('lineupEligible', () => {
  it('accepts a public, non-hub lineup in voting', () => {
    expect(lineupEligible(lineup())).toBe(true);
  });

  it.each<[string, Partial<LineupSyncRow>]>([
    ['hub-tagged', { guildId: 5 }],
    ['private', { visibility: 'private' }],
    ['standalone-carrier', { standalone: true }],
    ['building', { status: 'building' }],
    ['decided', { status: 'decided' }],
    ['archived', { status: 'archived' }],
  ])('refuses a %s lineup', (_, over) => {
    expect(lineupEligible(lineup(over))).toBe(false);
  });

  it('keeps a decided lineup on the planning path (sync only)', () => {
    expect(lineupOnPlanningPath(lineup({ status: 'decided' }))).toBe(true);
    expect(lineupOnPlanningPath(lineup({ standalone: true }))).toBe(false);
  });
});

describe('planningSubjectBody', () => {
  it('links the poll page', () => {
    const body = planningSubjectBody('https://raid.example/', {
      kind: 'poll',
      lineupId: 3,
      matchId: 7,
    });
    expect(body).toBe(
      'Plan this poll here.\nPoll page: https://raid.example/community-lineup/3/schedule/7',
    );
  });

  it('links the lineup page', () => {
    const body = planningSubjectBody('https://raid.example', {
      kind: 'lineup',
      lineupId: 3,
    });
    expect(body).toBe(
      'Plan this lineup here.\nLineup page: https://raid.example/community-lineup/3',
    );
  });

  it('is the line only when the client URL is not absolute', () => {
    const body = planningSubjectBody('/', { kind: 'lineup', lineupId: 3 });
    expect(body).toBe('Plan this lineup here.');
  });
});
