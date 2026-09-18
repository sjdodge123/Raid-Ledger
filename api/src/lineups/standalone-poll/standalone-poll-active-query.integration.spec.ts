/**
 * `findActiveStandalonePolls` — what the events-page banner is allowed to
 * advertise (integration, ROK-1609).
 *
 * Prod report 2026-09-17: the banner listed "PEAK · 1 slot · Vote →" and
 * "Valheim · 6 slots · Vote →" while both poll pages rendered the ■ POLL
 * EXPIRED banner. The query filtered on `m.status = 'scheduling'` and the
 * standalone flag only — nothing about the deadline, the archived lineup or
 * (per ROK-1607) whether any proposed time is still in the future.
 *
 * These cases pin the three exclusions plus the two things that MUST stay
 * listed: a live poll, and a poll nobody has suggested a time for yet.
 */
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { generatePublicSlug } from '../public-lineup-slug.helpers';
import { findActiveStandalonePolls } from './standalone-poll-query.helpers';

const HOUR_MS = 60 * 60 * 1000;

interface PollShape {
  /** Hours from now; null writes no deadline at all. */
  deadlineHours: number | null;
  lineupStatus?: 'decided' | 'archived';
  /** Hour offsets of the slots to seed; omit for a poll with no times. */
  slotHours?: number[];
  standalone?: boolean;
}

function describeActiveStandalonePolls(): void {
  let testApp: TestApp;
  let tag = 0;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  async function seedPoll(shape: PollShape): Promise<number> {
    const [lineup] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: `Active Query Poll ${++tag}`,
        status: shape.lineupStatus ?? 'decided',
        visibility: 'public',
        createdBy: testApp.seed.adminUser.id,
        includeSchedulingPhase: true,
        phaseDeadline:
          shape.deadlineHours === null
            ? null
            : new Date(Date.now() + shape.deadlineHours * HOUR_MS),
        phaseDurationOverride:
          shape.standalone === false ? {} : { standalone: true },
        publicSlug: generatePublicSlug(),
        publicShareEnabled: false,
      })
      .returning();
    const [match] = await testApp.db
      .insert(schema.communityLineupMatches)
      .values({
        lineupId: lineup.id,
        gameId: testApp.seed.game.id,
        status: 'scheduling',
        thresholdMet: true,
        voteCount: 1,
      })
      .returning();
    for (const hours of shape.slotHours ?? []) {
      await testApp.db.insert(schema.communityLineupScheduleSlots).values({
        matchId: match.id,
        proposedTime: new Date(Date.now() + hours * HOUR_MS),
        suggestedBy: 'user',
      });
    }
    return match.id;
  }

  async function activeMatchIds(): Promise<number[]> {
    const rows = await findActiveStandalonePolls(testApp.db);
    return rows.map((r) => r.matchId);
  }

  it('lists a live poll with a future time (AC2)', async () => {
    const live = await seedPoll({ deadlineHours: 48, slotHours: [5] });
    expect(await activeMatchIds()).toContain(live);
  });

  it('still lists a poll nobody has suggested a time for yet', async () => {
    const empty = await seedPoll({ deadlineHours: 48 });
    expect(await activeMatchIds()).toContain(empty);
  });

  it('drops a poll whose deadline has passed (AC1)', async () => {
    const expired = await seedPoll({ deadlineHours: -1, slotHours: [5] });
    expect(await activeMatchIds()).not.toContain(expired);
  });

  it('drops a poll whose lineup was archived', async () => {
    const archived = await seedPoll({
      deadlineHours: 48,
      lineupStatus: 'archived',
      slotHours: [5],
    });
    expect(await activeMatchIds()).not.toContain(archived);
  });

  it('drops a poll whose every proposed time has passed (ROK-1607)', async () => {
    const dead = await seedPoll({ deadlineHours: 48, slotHours: [-3, -2] });
    expect(await activeMatchIds()).not.toContain(dead);
  });

  it('keeps a poll with one past and one future time', async () => {
    const mixed = await seedPoll({ deadlineHours: 48, slotHours: [-2, 5] });
    expect(await activeMatchIds()).toContain(mixed);
  });

  it('keeps a NULL-deadline poll live, and drops it once its time passes', async () => {
    const live = await seedPoll({ deadlineHours: null, slotHours: [5] });
    const dead = await seedPoll({ deadlineHours: null, slotHours: [-2] });

    const ids = await activeMatchIds();

    expect(ids).toContain(live);
    expect(ids).not.toContain(dead);
  });

  it('still ignores non-standalone lineups', async () => {
    const notStandalone = await seedPoll({
      deadlineHours: 48,
      slotHours: [5],
      standalone: false,
    });
    expect(await activeMatchIds()).not.toContain(notStandalone);
  });

  it('returns the unchanged DTO shape for a listed poll', async () => {
    const live = await seedPoll({ deadlineHours: 48, slotHours: [5, 9] });

    const row = (await findActiveStandalonePolls(testApp.db)).find(
      (r) => r.matchId === live,
    );

    expect(row).toMatchObject({
      matchId: live,
      lineupId: expect.any(Number),
      gameName: expect.any(String),
      memberCount: 0,
      slotCount: 2,
    });
    expect(row).toHaveProperty('gameCoverUrl');
  });
}

describe(
  'findActiveStandalonePolls — expired polls excluded (integration)',
  describeActiveStandalonePolls,
);
