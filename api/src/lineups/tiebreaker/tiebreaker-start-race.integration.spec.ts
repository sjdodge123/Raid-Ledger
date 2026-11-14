/**
 * Backlog 2026-10-02 — two concurrent tiebreaker starts on one lineup.
 *
 * `TiebreakerService.start` checks "already active" on a read taken OUTSIDE
 * its transaction, so two concurrent `POST /lineups/:id/tiebreaker` could both
 * pass it and both commit an `active` row. `createActiveTiebreaker` now
 * re-reads the lineup `FOR UPDATE` inside the transaction: the second start
 * waits for the first to commit, sees its `activeTiebreakerId`, and gets the
 * same 400 the unlocked check throws.
 */
import { BadRequestException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { generatePublicSlug } from '../public-lineup-slug.helpers';
import { DiscordBotClientService } from '../../discord-bot/discord-bot-client.service';
import { nonEmpty } from '../../common/testing/narrow';
import { TiebreakerService } from './tiebreaker.service';

const TB = schema.communityLineupTiebreakers;

function describeStartRace() {
  let testApp: TestApp;
  let service: TiebreakerService;
  let sendEmbedSpy: jest.SpyInstance;
  let seq = 0;

  beforeAll(async () => {
    testApp = await getTestApp();
    service = testApp.app.get(TiebreakerService);
  });

  beforeEach(() => {
    sendEmbedSpy = jest
      .spyOn(testApp.app.get(DiscordBotClientService), 'sendEmbed')
      .mockResolvedValue({ id: 'mock-msg-tb-race' } as never);
  });

  afterEach(async () => {
    sendEmbedSpy.mockRestore();
    testApp.seed = await truncateAllTables(testApp.db);
  });

  /** One member nominating + voting for their own game → a tie of N. */
  async function addTiedVoter(lineupId: number): Promise<void> {
    seq += 1;
    const [user] = nonEmpty(
      await testApp.db
        .insert(schema.users)
        .values({
          discordId: `local:tb-race-${seq}@test.local`,
          username: `tb-race-${seq}`,
          role: 'member',
        })
        .returning(),
      'user',
    );
    const [game] = nonEmpty(
      await testApp.db
        .insert(schema.games)
        .values({ name: `TBRace${seq}`, slug: `tb-race-${seq}-${Date.now()}` })
        .returning(),
      'game',
    );
    const row = { lineupId, gameId: game.id };
    await testApp.db
      .insert(schema.communityLineupEntries)
      .values({ ...row, nominatedBy: user.id });
    await testApp.db
      .insert(schema.communityLineupVotes)
      .values({ ...row, userId: user.id });
  }

  async function createTiedLineup(): Promise<number> {
    const [lineup] = nonEmpty(
      await testApp.db
        .insert(schema.communityLineups)
        .values({
          title: 'tiebreaker start race',
          status: 'voting',
          visibility: 'public',
          createdBy: testApp.seed.adminUser.id,
          publicSlug: generatePublicSlug(),
        })
        .returning(),
      'lineup',
    );
    await addTiedVoter(lineup.id);
    await addTiedVoter(lineup.id);
    return lineup.id;
  }

  it('lets exactly one of two concurrent starts through; the other gets the "already active" 400', async () => {
    const lineupId = await createTiedLineup();
    const admin = { id: testApp.seed.adminUser.id, role: 'admin' as const };
    const dto = { mode: 'veto' as const, roundDurationHours: 24 };

    const results = await Promise.allSettled([
      service.start(lineupId, dto, admin),
      service.start(lineupId, dto, admin),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.flatMap((r) =>
      r.status === 'rejected' ? [r.reason] : [],
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toEqual([
      new BadRequestException('A tiebreaker is already active'),
    ]);
    const active = await testApp.db
      .select({ id: TB.id })
      .from(TB)
      .where(and(eq(TB.lineupId, lineupId), eq(TB.status, 'active')));
    expect(active).toHaveLength(1);
  });
}

describe(
  'tiebreaker start is serialised per lineup (integration)',
  describeStartRace,
);
