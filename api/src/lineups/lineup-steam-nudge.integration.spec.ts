/**
 * ROK-1684 — Integration test for the "Link your Steam account" nudge.
 *
 * The nudge fans out to every user with Discord linked and no Steam. It must
 * NOT reach deactivated, kicked or banned users. Drives
 * `LineupSteamNudgeService.nudgeUnlinkedMembers` directly against the real DB
 * and asserts which seeded users received a `lineup_steam_nudge` row.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { LineupSteamNudgeService } from './lineup-steam-nudge.service';

type ModerationState = Partial<
  Pick<
    typeof schema.users.$inferInsert,
    'deactivatedAt' | 'kickedAt' | 'bannedAt'
  >
>;

function describeSteamNudgeModeration() {
  let testApp: TestApp;
  let service: LineupSteamNudgeService;

  beforeAll(async () => {
    testApp = await getTestApp();
    service = testApp.app.get(LineupSteamNudgeService);
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  /** Insert a Discord-linked user with no Steam and the given moderation state. */
  async function createUnlinkedUser(
    suffix: string,
    state: ModerationState = {},
  ): Promise<number> {
    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: `discord:nudge-${suffix}`,
        username: `nudge-${suffix}`,
        role: 'member',
        steamId: null,
        ...state,
      })
      .returning();
    return user.id;
  }

  /** User ids among `candidates` that received a Steam nudge. */
  async function nudgedUserIds(candidates: number[]): Promise<number[]> {
    const rows = await testApp.db
      .select({ userId: schema.notifications.userId })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.type, 'lineup_steam_nudge'),
          inArray(schema.notifications.userId, candidates),
        ),
      );
    return rows.map((r) => r.userId).sort((a, b) => a - b);
  }

  it('nudges only the active unlinked user, not deactivated/kicked/banned ones', async () => {
    const now = new Date();
    const activeId = await createUnlinkedUser('active');
    const deactivatedId = await createUnlinkedUser('deactivated', {
      deactivatedAt: now,
    });
    const kickedId = await createUnlinkedUser('kicked', { kickedAt: now });
    const bannedId = await createUnlinkedUser('banned', { bannedAt: now });
    // Unique lineup id so the Redis dedup cache can't leak across runs.
    const lineupId = 1_000_000 + (Date.now() % 1_000_000);

    await service.nudgeUnlinkedMembers(lineupId);

    expect(
      await nudgedUserIds([activeId, deactivatedId, kickedId, bannedId]),
    ).toEqual([activeId]);
  });
}

describe('LineupSteamNudgeService moderation filter (integration)', () =>
  describeSteamNudgeModeration());
