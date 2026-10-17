/**
 * ROK-1830 S5 — onboarding dismissals against a real database (D11-B, Q9).
 *
 * The contract S5b depends on: a caller reads and writes ONLY their own rows,
 * a repeat dismiss is a no-op rather than a unique violation (including in
 * the global scope, where Postgres' NULL-never-equals rule would otherwise
 * let duplicates through), and the global and per-hub scopes are independent.
 */
import { eq } from 'drizzle-orm';
import { BadRequestException } from '@nestjs/common';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { HubOnboardingService } from './hub-onboarding.service';

const CARD = 'players-get-your-guild';
const CHECKLIST = 'hub-setup-checklist';

let testApp: TestApp;
let onboarding: HubOnboardingService;

beforeAll(async () => {
  testApp = await getTestApp();
  onboarding = testApp.app.get(HubOnboardingService);
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

async function seedUser(username: string): Promise<number> {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${username}`, username })
      .returning(),
    'user',
  );
  return user.id;
}

async function seedGuild(name: string): Promise<number> {
  const [guild] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: testApp.seed.game.id,
        region: 'us',
        name,
        nameKey: name.toLowerCase(),
        source: 'addon_import',
      })
      .returning(),
    'guild',
  );
  return guild.id;
}

async function rowCount(userId: number): Promise<number> {
  const rows = await testApp.db
    .select({ id: schema.hubOnboardingDismissals.id })
    .from(schema.hubOnboardingDismissals)
    .where(eq(schema.hubOnboardingDismissals.userId, userId));
  return rows.length;
}

describe('HubOnboardingService (integration)', () => {
  it('starts empty and records a global dismissal', async () => {
    const userId = await seedUser('onboard-a');

    expect(await onboarding.getState(userId)).toEqual({ dismissed: [] });

    const after = await onboarding.dismiss(userId, CARD, {});
    expect(after.dismissed).toHaveLength(1);
    expect(after.dismissed[0]?.key).toBe(CARD);
    expect(after.dismissed[0]?.guildId).toBeNull();
  });

  it('is idempotent in the global scope (NULL guild_id must not duplicate)', async () => {
    const userId = await seedUser('onboard-b');

    await onboarding.dismiss(userId, CARD, {});
    const second = await onboarding.dismiss(userId, CARD, {});

    expect(second.dismissed).toHaveLength(1);
    expect(await rowCount(userId)).toBe(1);
  });

  it('is idempotent per hub and keeps the two hubs apart', async () => {
    const userId = await seedUser('onboard-c');
    const one = await seedGuild('Hub One');
    const two = await seedGuild('Hub Two');

    await onboarding.dismiss(userId, CHECKLIST, { guildId: String(one) });
    await onboarding.dismiss(userId, CHECKLIST, { guildId: String(one) });
    await onboarding.dismiss(userId, CHECKLIST, { guildId: String(two) });

    const state = await onboarding.getState(userId);
    expect(state.dismissed.map((d) => d.guildId).sort()).toEqual(
      [one, two].sort(),
    );
    expect(await rowCount(userId)).toBe(2);
  });

  it('keeps the global and per-hub scopes of one key independent', async () => {
    const userId = await seedUser('onboard-d');
    const guildId = await seedGuild('Hub Scope');

    await onboarding.dismiss(userId, CHECKLIST, {});
    await onboarding.dismiss(userId, CHECKLIST, { guildId: String(guildId) });
    await onboarding.restore(userId, CHECKLIST, { guildId: String(guildId) });

    const state = await onboarding.getState(userId);
    expect(state.dismissed).toHaveLength(1);
    expect(state.dismissed[0]?.guildId).toBeNull();
  });

  it('undoes a dismissal, and undoing twice is a no-op', async () => {
    const userId = await seedUser('onboard-e');

    await onboarding.dismiss(userId, CARD, {});
    expect(await onboarding.restore(userId, CARD, {})).toEqual({
      dismissed: [],
    });
    expect(await onboarding.restore(userId, CARD, {})).toEqual({
      dismissed: [],
    });
  });
});

describe('HubOnboardingService scoping (integration)', () => {
  it('never shows or touches another user rows', async () => {
    const mine = await seedUser('onboard-mine');
    const theirs = await seedUser('onboard-theirs');

    await onboarding.dismiss(theirs, CARD, {});

    expect(await onboarding.getState(mine)).toEqual({ dismissed: [] });

    // My "undo" of the same key must not delete their row.
    await onboarding.restore(mine, CARD, {});
    expect(await rowCount(theirs)).toBe(1);
  });

  it('refuses an unknown key before writing anything', async () => {
    const userId = await seedUser('onboard-f');

    await expect(
      onboarding.dismiss(userId, 'not-a-prompt', {}),
    ).rejects.toThrow(BadRequestException);
    expect(await rowCount(userId)).toBe(0);
  });
});
