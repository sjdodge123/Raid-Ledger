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
/** `discord-embed-scheduling.helpers::buildSchedulingPollEmbed` title. */
const POLL_TITLE_PREFIX = 'When should we play ';
/** The open-poll author line (`▸ POLL OPEN · N voters`). */
const POLL_OPEN_AUTHOR = 'POLL OPEN';

/** The subset of an embed's JSON body these assertions read. */
interface SentEmbed {
  title?: string;
  description?: string;
  author?: { name?: string };
}

/** Poll until `check` returns a value, or fail with `label`. */
async function pollUntil<T>(
  check: () => Promise<T | null>,
  label: string,
  timeoutMs = 5000,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await check();
    if (value !== null) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`);
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
    visibility: 'public' | 'private' = 'public',
  ): Promise<{ lineupId: number; gameId: number; voterId: number }> {
    const gameId = await createGame(`PollCard-${Date.now()}`);
    const voterId = testApp.seed.adminUser.id;
    const [lineup] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title,
        status: 'voting',
        visibility,
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

  /**
   * Decide the lineup and wait for the fire-and-forget card to PERSIST.
   *
   * Waiting on the stored `embed_message_id` (not on the spy) is deliberate:
   * the decide transition also posts the "matches found" lineup card through
   * the same `sendEmbed`, so a spy-count wait can return on the wrong embed
   * and read the match row before the poll card's store write lands.
   */
  async function decideAndAwaitCard(lineupId: number) {
    await lineupsService.transitionStatus(lineupId, { status: 'decided' });
    return pollUntil(async () => {
      const match = await loadMatch(lineupId);
      return match?.embedMessageId ? match : null;
    }, `poll card stored for lineup ${lineupId}`);
  }

  /** JSON body of every embed sent through the spied client. */
  function sentEmbeds(): SentEmbed[] {
    return sendEmbedSpy.mock.calls.map((call) => {
      const embed = call[1] as { toJSON?: () => SentEmbed };
      return embed?.toJSON?.() ?? {};
    });
  }

  /** Embeds carrying this match's poll link, whoever sent them. */
  function sendsLinkingPoll(lineupId: number, matchId: number): SentEmbed[] {
    const path = `/community-lineup/${lineupId}/schedule/${matchId})`;
    return sentEmbeds().filter((e) => (e.description ?? '').includes(path));
  }

  /**
   * The scheduling-poll CARDS only, identified by the poll embed's own
   * identity — its `When should we play …?` title plus the `POLL OPEN`
   * author line.
   *
   * Filtering on the `/schedule/:matchId` link alone is not enough: the
   * pre-existing bandwagon "enough players" notice links the SAME poll for a
   * different purpose, so it was counted as a duplicate card (ROK-1473
   * review). The lineup family also posts matches-found and event-created
   * embeds through this client, which is why the raw spy count is never the
   * assertion.
   */
  function pollCardSends(lineupId: number, matchId: number): string[] {
    return sendsLinkingPoll(lineupId, matchId)
      .filter(
        (e) =>
          (e.title ?? '').startsWith(POLL_TITLE_PREFIX) &&
          (e.author?.name ?? '').includes(POLL_OPEN_AUTHOR),
      )
      .map((e) => e.description ?? '');
  }

  /**
   * The legacy scheduling notices: they link the poll but are NOT the card.
   * Asserted explicitly so the two surfaces stay distinguishable on purpose.
   */
  function pollNoticeSends(lineupId: number, matchId: number): string[] {
    return sendsLinkingPoll(lineupId, matchId)
      .filter((e) => !(e.title ?? '').startsWith(POLL_TITLE_PREFIX))
      .map((e) => e.description ?? '');
  }

  // ── Matching flip site (voting → decided) ──────────────────────────────

  it('posts one poll card when a lineup match enters scheduling', async () => {
    const { lineupId } = await seedVotingLineup('ROK-1473 decided');

    const match = await decideAndAwaitCard(lineupId);

    expect(match.status).toBe('scheduling');
    const cards = pollCardSends(lineupId, match.id);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toContain('[Vote now');
    const cardCall = sendEmbedSpy.mock.calls.find((call) =>
      (call[1] as { toJSON?: () => { description?: string } })
        ?.toJSON?.()
        .description?.includes(`/schedule/${match.id})`),
    );
    expect(cardCall?.[0]).toBe(CHANNEL);
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
    await new Promise((r) => setTimeout(r, 500));

    expect(pollCardSends(lineupId, match.id)).toHaveLength(1);
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

    await pollUntil(
      () => Promise.resolve(editEmbedSpy.mock.calls.length > 0 || null),
      'the poll card to be edited on lock-in',
    );
    const [editChannel, editMessageId] = editEmbedSpy.mock.calls[0] as [
      string,
      string,
    ];
    expect(editChannel).toBe(CHANNEL);
    expect(editMessageId).toBe(MESSAGE_ID);
    // The lock-in EDITS the stored message — it must not post a second card.
    expect(pollCardSends(lineupId, match.id)).toHaveLength(1);
  });

  // ── Private lineups keep the poll out of the channel ──────────────────

  it('posts no channel card for a private lineup', async () => {
    const { lineupId } = await seedVotingLineup('ROK-1473 private', 'private');

    await lineupsService.transitionStatus(lineupId, { status: 'decided' });
    // Give the fire-and-forget listener room to misbehave before asserting.
    await new Promise((r) => setTimeout(r, 500));

    const match = await loadMatch(lineupId);
    expect(match.status).toBe('scheduling');
    expect(pollCardSends(lineupId, match.id)).toHaveLength(0);
    expect(match.embedMessageId).toBeNull();
    expect(match.embedChannelId).toBeNull();
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
    const stored = await pollUntil(async () => {
      const row = await loadMatch(lineup.id);
      return row?.embedMessageId ? row : null;
    }, `poll card stored for bandwagon match ${match.id}`);
    expect(stored.embedChannelId).toBe(CHANNEL);
    // Exactly ONE poll card. The legacy "enough players — Vote on a time ↗"
    // notice fires on the same promote (fire-and-forget beside the card) and is
    // suppressed by `hasExistingPollEmbed` when the card lands first, so it is
    // 0 or 1 depending on which write wins — never 2 (see TECH-DEBT 2026-09-03,
    // ROK-1473 notice/card race).
    expect(pollCardSends(lineup.id, match.id)).toHaveLength(1);
    expect(pollNoticeSends(lineup.id, match.id).length).toBeLessThanOrEqual(1);
  });
}

describe(
  'Scheduling poll card on phase entry (integration, ROK-1473)',
  describeSchedulingPollCard,
);
