/**
 * Post-event follow-up POLL path — create-form prefill back-reference.
 *
 * The [Start a poll] button opens a StandalonePoll with NO `linkedEventId`
 * (HARD CONSTRAINT 5), so nothing on the poll pointed back at the ended event.
 * When the organizer later locked a time in, the create-event form therefore
 * opened blank. `post_event_followup_sent.match_id` closes that gap: it is
 * stamped on poll create and read back at lock-in to prefill the form.
 *
 * Covered here:
 *   1. A successful poll click stamps `match_id` (real FK row, not a stub id).
 *   2. `findFollowupSourceEventId` resolves the match back to the ended event.
 *   3. An ordinary (non-follow-up) match resolves to null.
 *   4. A failed poll create leaves `match_id` null alongside the rolled-back
 *      `choice` claim.
 */
import { eq } from 'drizzle-orm';
import type { ButtonInteraction } from 'discord.js';
import { Logger } from '@nestjs/common';
import type { SchedulingPollResponseDto } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { generatePublicSlug } from '../lineups/public-lineup-slug.helpers';
import { findFollowupSourceEventId } from '../lineups/scheduling/scheduling-query.helpers';
import {
  handlePollClick,
  type PostEventFollowupDeps,
} from '../discord-bot/listeners/post-event-followup-interaction.handlers';

const HOUR = 60 * 60 * 1000;
let seq = 0;

async function mkUser(testApp: TestApp) {
  seq += 1;
  const [user] = await testApp.db
    .insert(schema.users)
    .values({
      discordId: `71000000000000${String(seq).padStart(4, '0')}`,
      username: `pf${seq}`,
      role: 'member',
    })
    .returning();
  return user;
}

/** An ended event with one attendee + the M2 sentinel row the cron creates. */
async function mkEndedEventWithSentinel(testApp: TestApp, creatorId: number) {
  const [event] = await testApp.db
    .insert(schema.events)
    .values({
      title: 'Ended Event',
      creatorId,
      gameId: testApp.seed.game.id,
      duration: [new Date(Date.now() - 3 * HOUR), new Date(Date.now() - HOUR)],
    })
    .returning();
  const attendee = await mkUser(testApp);
  await testApp.db
    .insert(schema.eventSignups)
    .values({ eventId: event.id, userId: attendee.id, status: 'signed_up' });
  await testApp.db
    .insert(schema.postEventFollowupSent)
    .values({ eventId: event.id });
  return event;
}

/** A real lineup + match so `match_id`'s FK resolves against actual rows. */
async function mkMatch(testApp: TestApp, creatorId: number) {
  const [lineup] = await testApp.db
    .insert(schema.communityLineups)
    .values({
      title: 'Follow-up poll',
      status: 'decided',
      visibility: 'public',
      createdBy: creatorId,
      phaseDurationOverride: { standalone: true },
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
      voteCount: 0,
    })
    .returning();
  return { lineupId: lineup.id, matchId: match.id };
}

function pollResponse(
  testApp: TestApp,
  ids: { matchId: number; lineupId: number },
): SchedulingPollResponseDto {
  return {
    id: ids.matchId,
    lineupId: ids.lineupId,
    gameId: testApp.seed.game.id,
    gameName: 'Test Game',
    gameCoverUrl: null,
    memberCount: 1,
    status: 'scheduling',
    createdAt: new Date().toISOString(),
  };
}

function makeDeps(testApp: TestApp, create: jest.Mock): PostEventFollowupDeps {
  return {
    db: testApp.db,
    standalonePollService: { create },
    notificationService: { createMany: jest.fn().mockResolvedValue([]) },
    settingsService: {
      getClientUrl: jest.fn().mockResolvedValue('https://app.test'),
    },
    logger: new Logger('test'),
  };
}

function mockInteraction(): ButtonInteraction {
  return {
    editReply: jest.fn().mockResolvedValue(undefined),
  } as unknown as ButtonInteraction;
}

async function getSentinel(testApp: TestApp, eventId: number) {
  const [row] = await testApp.db
    .select()
    .from(schema.postEventFollowupSent)
    .where(eq(schema.postEventFollowupSent.eventId, eventId))
    .limit(1);
  return row;
}

describe('post-event follow-up poll → create-form prefill', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  beforeEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  it('stamps match_id on the sentinel when the poll opens', async () => {
    const creator = await mkUser(testApp);
    const event = await mkEndedEventWithSentinel(testApp, creator.id);
    const { matchId, lineupId } = await mkMatch(testApp, creator.id);
    const create = jest
      .fn()
      .mockResolvedValue(pollResponse(testApp, { matchId, lineupId }));

    await handlePollClick(makeDeps(testApp, create), mockInteraction(), {
      id: event.id,
      title: event.title,
      creatorId: creator.id,
      gameId: testApp.seed.game.id,
    });

    expect((await getSentinel(testApp, event.id)).matchId).toBe(matchId);
  });

  it('resolves the match back to the ended event for the prefill', async () => {
    const creator = await mkUser(testApp);
    const event = await mkEndedEventWithSentinel(testApp, creator.id);
    const { matchId, lineupId } = await mkMatch(testApp, creator.id);
    const create = jest
      .fn()
      .mockResolvedValue(pollResponse(testApp, { matchId, lineupId }));

    await handlePollClick(makeDeps(testApp, create), mockInteraction(), {
      id: event.id,
      title: event.title,
      creatorId: creator.id,
      gameId: testApp.seed.game.id,
    });

    expect(await findFollowupSourceEventId(testApp.db, matchId)).toBe(event.id);
  });

  it('resolves to null for an ordinary poll, so no prefill is offered', async () => {
    const creator = await mkUser(testApp);
    const { matchId } = await mkMatch(testApp, creator.id);

    expect(await findFollowupSourceEventId(testApp.db, matchId)).toBeNull();
  });

  it('leaves match_id null when the poll create fails', async () => {
    const creator = await mkUser(testApp);
    const event = await mkEndedEventWithSentinel(testApp, creator.id);
    const create = jest.fn().mockRejectedValue(new Error('poll boom'));

    await handlePollClick(makeDeps(testApp, create), mockInteraction(), {
      id: event.id,
      title: event.title,
      creatorId: creator.id,
      gameId: testApp.seed.game.id,
    });

    const sentinel = await getSentinel(testApp, event.id);
    expect(sentinel.matchId).toBeNull();
    // The choice claim is rolled back too, so the organizer can retry.
    expect(sentinel.choice).toBeNull();
  });
});
