/**
 * ROK-1282 — GuildReconciliationService integration tests.
 *
 * Verifies the daily reconciliation cron's core behaviour:
 *   - users whose `discord_id` is missing from the live guild get
 *     deactivated via the shared notification path,
 *   - already-deactivated users are not re-touched,
 *   - users with `local:%` / `unlinked:%` placeholder ids are skipped
 *     (they were never guild-tracked),
 *   - bot disconnected → no-op (returns false).
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { eq } from 'drizzle-orm';
import { GuildReconciliationService } from './guild-reconciliation.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';

let testApp: TestApp;
let service: GuildReconciliationService;
let botClient: DiscordBotClientService;
let listSpy: jest.SpyInstance;

beforeAll(async () => {
  testApp = await getTestApp();
  service = testApp.app.get(GuildReconciliationService);
  botClient = testApp.app.get(DiscordBotClientService);
});

afterEach(async () => {
  if (listSpy) listSpy.mockRestore();
  testApp.seed = await truncateAllTables(testApp.db);
});

async function createUserWithDiscordId(
  username: string,
  discordId: string,
): Promise<typeof schema.users.$inferSelect> {
  const [user] = await testApp.db
    .insert(schema.users)
    .values({ discordId, username, role: 'member' })
    .returning();
  return user;
}

async function getDeactivatedAt(userId: number): Promise<Date | string | null> {
  const [row] = await testApp.db
    .select({ deactivatedAt: schema.users.deactivatedAt })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return row?.deactivatedAt ?? null;
}

function mockGuildMembers(ids: string[]): void {
  listSpy = jest
    .spyOn(botClient, 'listAllGuildMemberIds')
    .mockResolvedValue(new Set(ids));
}

function mockBotDisconnected(): void {
  listSpy = jest
    .spyOn(botClient, 'listAllGuildMemberIds')
    .mockResolvedValue(null);
}

describe('GuildReconciliationService.runReconciliation (ROK-1282)', () => {
  it('deactivates users whose discord_id is no longer in the guild', async () => {
    const inGuild1 = await createUserWithDiscordId('alpha', '111111');
    const inGuild2 = await createUserWithDiscordId('beta', '222222');
    const gone1 = await createUserWithDiscordId('gamma', '333333');
    const gone2 = await createUserWithDiscordId('delta', '444444');

    mockGuildMembers(['111111', '222222']);

    await service.runReconciliation();

    expect(await getDeactivatedAt(inGuild1.id)).toBeNull();
    expect(await getDeactivatedAt(inGuild2.id)).toBeNull();
    expect(await getDeactivatedAt(gone1.id)).not.toBeNull();
    expect(await getDeactivatedAt(gone2.id)).not.toBeNull();
  });

  it('skips users with local: discord_id (email-only accounts)', async () => {
    const local = await createUserWithDiscordId(
      'localonly',
      'local:localonly@test.local',
    );

    mockGuildMembers([]);

    await service.runReconciliation();

    expect(await getDeactivatedAt(local.id)).toBeNull();
  });

  it('skips users with unlinked: discord_id (previously unlinked accounts)', async () => {
    const unlinked = await createUserWithDiscordId(
      'unlinkedacct',
      'unlinked:555555',
    );

    mockGuildMembers([]);

    await service.runReconciliation();

    expect(await getDeactivatedAt(unlinked.id)).toBeNull();
  });

  it('does not re-touch users that are already deactivated', async () => {
    const alreadyOff = await createUserWithDiscordId('zombie', '666666');
    await testApp.db.execute(
      /* sql */ `UPDATE users SET deactivated_at = '2025-01-01T00:00:00Z' WHERE id = ${alreadyOff.id}`,
    );
    const before = await getDeactivatedAt(alreadyOff.id);

    mockGuildMembers([]);

    await service.runReconciliation();

    expect(await getDeactivatedAt(alreadyOff.id)).toStrictEqual(before);
  });

  it('returns false (no-op) when the Discord bot is disconnected', async () => {
    const lonely = await createUserWithDiscordId('lonely', '777777');
    mockBotDisconnected();

    const result = await service.runReconciliation();

    expect(result).toBe(false);
    expect(await getDeactivatedAt(lonely.id)).toBeNull();
  });

  // Codex P2 (2026-05-14): only the disconnected case is a no-op; any Discord
  // API fault must bubble so CronJobService records a real failure instead of
  // a silent healthy heartbeat.
  it('lets Discord API errors bubble up (not swallowed as a no-op)', async () => {
    const survivor = await createUserWithDiscordId('survivor', '888888');
    const apiFault = new Error('DiscordAPIError: Missing Permissions');
    listSpy = jest
      .spyOn(botClient, 'listAllGuildMemberIds')
      .mockRejectedValue(apiFault);

    await expect(service.runReconciliation()).rejects.toBe(apiFault);
    expect(await getDeactivatedAt(survivor.id)).toBeNull();
  });
});
