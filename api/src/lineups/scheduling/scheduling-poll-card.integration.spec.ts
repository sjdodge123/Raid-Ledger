/**
 * ROK-1473 — a community lineup's own scheduling poll posts its Discord card.
 *
 * CONFIRMED FAILING on the branch base: nothing called
 * `SchedulingPollEmbedService.firePostInitialEmbed` for a lineup-phase match,
 * so `community_lineup_matches.embed_message_id` stayed NULL, `updateEmbed`
 * returned early forever, and the channel never saw the poll.
 *
 * Regression proof: revert the `fireMatchEnteredScheduling(...)` call in
 * `lineups-lifecycle.helpers::runMatchingAlgorithm` and
 * "posts one poll card when a lineup's match enters scheduling" fails with
 * 0 sendEmbed calls.
 */
import { eq } from 'drizzle-orm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { LineupsService } from '../lineups.service';
import { SchedulingService } from './scheduling.service';
import { DiscordBotClientService } from '../../discord-bot/discord-bot-client.service';
import { SettingsService } from '../../settings/settings.service';
import { LINEUP_MATCH_EVENTS } from '../lineups-scheduling-hook.helpers';
import { generatePublicSlug } from '../public-lineup-slug.helpers';

const CHANNEL = 'test-channel-1473';
const MESSAGE_ID = 'mock-msg-1473';

/**
 * Poll until a spy has been called at least `count` times.
 * The card is posted fire-and-forget (D4), so the flip returns before it.
 */
async function waitForCalls(
  spy: jest.SpyInstance,
  count: number,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (spy.mock.calls.length >= count) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(
    `Expected ${count} call(s), saw ${spy.mock.calls.length} within ${timeoutMs}ms`,
  );
}

function describeSchedulingPollCard() {
  let testApp: TestApp;
  let lineupsService: LineupsService;
  let schedulingService: SchedulingService;
  let botClient: DiscordBotClientService;
  let settings: SettingsService;
  let events: EventEmitter2;
  let sendEmbedSpy: jest.SpyInstance;
  let editEmbedSpy: jest.SpyInstance;

  beforeAll(async () => {
    testApp = await getTestApp();
    await loginAsAdmin(testApp.request, testApp.seed);
    lineupsService = testApp.app.get(LineupsService);
    schedulingService = testApp.app.get(SchedulingService);
    botClient = testApp.app.get(DiscordBotClientService);
    settings = testApp.app.get(SettingsService);
    events = testApp.app.get(EventEmitter2);
  });

  beforeEach(async () => {
    sendEmbedSpy = jest
      .spyOn(botClient, 'sendEmbed')
      .mockResolvedValue({ id: MESSAGE_ID } as never);
    editEmbedSpy = jest
      .spyOn(botClient, 'editEmbed')
      .mockResolvedValue(undefined as never);
    await settings.setDiscordBotDefaultChannel(CHANNEL);
  });

  afterEach(async () => {
    sendEmbedSpy.mockRestore();
    editEmbedSpy.mockRestore();
    testApp.seed = await truncateAllTables(testApp.db);
    await loginAsAdmin(testApp.request, testApp.seed);
  });

  // ── Helpers ────────────────────────────────────────────────────────────

  async function createGame(name: string): Promise<number> {
    const [g] = await testApp.db
      .insert(schema.games)
      .values({ name, slug: `${name.toLowerCase()}-${Date.now()}` })
      .returning();
    return g.id;
  }

  /** A voting lineup with one nominated game carrying one vote (100%). */
  async function seedVotingLineup(
    title: string,
  ): Promise<{ lineupId: number; gameId: number; voterId: number }> {
    const gameId = await createGame(`PollCard-${Date.now()}`);
    const voterId = testApp.seed.adminUser.id;
    const [lineup] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title,
        status: 'voting',
        visibility: 'public',
        createdBy: voterId,
        publicSlug: generatePublicSlug(),
      })
      .returning();
    await testApp.db
      .insert(schema.communityLineupEntries)
      .values({ lineupId: lineup.id, gameId, nominatedBy: voterId });
    await testApp.db
      .insert(schema.communityLineupVotes)
      .values({ lineupId: lineup.id, gameId, userId: voterId });
    return { lineupId: lineup.id, gameId, voterId };
  }

  /** The match row the matching algorithm produced for a lineup. */
  async function loadMatch(lineupId: number) {
    const [match] = await testApp.db
      .select()
      .from(schema.communityLineupMatches)
      .where(eq(schema.communityLineupMatches.lineupId, lineupId))
      .limit(1);
    return match;
  }

  /** Decide the lineup and wait for the fire-and-forget card to land. */
  async function decideAndAwaitCard(lineupId: number) {
    await lineupsService.transitionStatus(lineupId, { status: 'decided' });
    await waitForCalls(sendEmbedSpy, 1);
    return loadMatch(lineupId);
  }

  /** JSON body of the embed handed to `sendEmbed`. */
  function sentEmbedJson(): {
    description?: string;
    author?: { name: string };
  } {
    const embed = sendEmbedSpy.mock.calls[0][1] as {
      toJSON: () => { description?: string; author?: { name: string } };
    };
    return embed.toJSON();
  }

  // ── Matching flip site (voting → decided) ──────────────────────────────

  it('posts one poll card when a lineup match enters scheduling', async () => {
    const { lineupId } = await seedVotingLineup('ROK-1473 decided');

    const match = await decideAndAwaitCard(lineupId);

    expect(match.status).toBe('scheduling');
    expect(sendEmbedSpy.mock.calls[0][0]).toBe(CHANNEL);
    expect(sentEmbedJson().description).toContain(
      `/community-lineup/${lineupId}/schedule/${match.id})`,
    );
    expect(sentEmbedJson().description).toContain('[Vote now');
  });

  it('stores the posted message reference on the match row', async () => {
    const { lineupId } = await seedVotingLineup('ROK-1473 stored');

    const match = await decideAndAwaitCard(lineupId);

    expect(match.embedMessageId).toBe(MESSAGE_ID);
    expect(match.embedChannelId).toBe(CHANNEL);
  });

  it('does not post a second card when the hook fires again', async () => {
    const { lineupId } = await seedVotingLineup('ROK-1473 re-entry');
    const match = await decideAndAwaitCard(lineupId);

    events.emit(LINEUP_MATCH_EVENTS.ENTERED_SCHEDULING, { matchId: match.id });
    await new Promise((r) => setTimeout(r, 250));

    expect(sendEmbedSpy).toHaveBeenCalledTimes(1);
  });

  it('edits the stored message on lock-in instead of posting a new card', async () => {
    const { lineupId, voterId } = await seedVotingLineup('ROK-1473 lock-in');
    const match = await decideAndAwaitCard(lineupId);
    const [slot] = await testApp.db
      .insert(schema.communityLineupScheduleSlots)
      .values({
        matchId: match.id,
        proposedTime: new Date(Date.now() + 86_400_000),
        suggestedBy: 'user',
      })
      .returning();
    await testApp.db
      .insert(schema.communityLineupScheduleVotes)
      .values({ slotId: slot.id, userId: voterId });

    await schedulingService.createEventFromSlot(match.id, slot.id, voterId);

    await waitForCalls(editEmbedSpy, 1);
    const [editChannel, editMessageId] = editEmbedSpy.mock.calls[0] as [
      string,
      string,
    ];
    expect(editChannel).toBe(CHANNEL);
    expect(editMessageId).toBe(MESSAGE_ID);
    expect(sendEmbedSpy).toHaveBeenCalledTimes(1);
  });

  // ── Bandwagon flip site (late joiner trips the threshold) ──────────────

  it('posts the card when a bandwagon join promotes a suggested match', async () => {
    const gameId = await createGame(`Bandwagon-${Date.now()}`);
    const creatorId = testApp.seed.adminUser.id;
    const [lineup] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: 'ROK-1473 bandwagon',
        status: 'decided',
        visibility: 'public',
        createdBy: creatorId,
        publicSlug: generatePublicSlug(),
      })
      .returning();
    // voteCount 1 at 50% → the original tally had 2 voters, so a single
    // bandwagon member re-reaches 50% and trips the 35% threshold.
    const [match] = await testApp.db
      .insert(schema.communityLineupMatches)
      .values({
        lineupId: lineup.id,
        gameId,
        status: 'suggested',
        thresholdMet: false,
        voteCount: 1,
        votePercentage: '50.00',
      })
      .returning();

    const result = await lineupsService.bandwagonJoin(
      lineup.id,
      match.id,
      creatorId,
      'admin',
    );

    expect(result.promoted).toBe(true);
    await waitForCalls(sendEmbedSpy, 1);
    expect(sentEmbedJson().description).toContain(
      `/community-lineup/${lineup.id}/schedule/${match.id})`,
    );
  });
}

describe(
  'Scheduling poll card on phase entry (integration, ROK-1473)',
  describeSchedulingPollCard,
);
