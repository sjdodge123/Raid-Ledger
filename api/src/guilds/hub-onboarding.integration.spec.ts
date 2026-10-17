/**
 * ROK-1830 S5 — onboarding dismissals against a real database (D11-B, Q9).
 *
 * The contract S5b depends on: a caller reads and writes ONLY their own rows,
 * a repeat dismiss is a no-op rather than a unique violation (including in
 * the global scope, where Postgres' NULL-never-equals rule would otherwise
 * let duplicates through), and the global and per-hub scopes are independent.
 */
import { eq } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import type { GuildActor } from './guild-access.service';
import { HubOnboardingService } from './hub-onboarding.service';

const CARD = 'players-get-your-guild';
const CHECKLIST = 'hub-setup-checklist';
const PASSWORD = 'TestPassword123!';

/**
 * The storage cases below are about scoping and idempotency, not about who
 * may write — staff see and edit every guild, so this actor keeps those
 * assertions on the behaviour they were written for. Authorization has its
 * own describe block with real members, officers and outsiders.
 */
const staff = (id: number): GuildActor => ({ id, role: 'admin' });
const member = (id: number): GuildActor => ({ id, role: 'member' });

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

    const after = await onboarding.dismiss(staff(userId), CARD, {});
    expect(after.dismissed).toHaveLength(1);
    expect(after.dismissed[0]?.key).toBe(CARD);
    expect(after.dismissed[0]?.guildId).toBeNull();
  });

  it('is idempotent in the global scope (NULL guild_id must not duplicate)', async () => {
    const userId = await seedUser('onboard-b');

    await onboarding.dismiss(staff(userId), CARD, {});
    const second = await onboarding.dismiss(staff(userId), CARD, {});

    expect(second.dismissed).toHaveLength(1);
    expect(await rowCount(userId)).toBe(1);
  });

  it('is idempotent per hub and keeps the two hubs apart', async () => {
    const userId = await seedUser('onboard-c');
    const one = await seedGuild('Hub One');
    const two = await seedGuild('Hub Two');

    await onboarding.dismiss(staff(userId), CHECKLIST, {
      guildId: String(one),
    });
    await onboarding.dismiss(staff(userId), CHECKLIST, {
      guildId: String(one),
    });
    await onboarding.dismiss(staff(userId), CHECKLIST, {
      guildId: String(two),
    });

    const state = await onboarding.getState(userId);
    expect(state.dismissed.map((d) => d.guildId).sort()).toEqual(
      [one, two].sort(),
    );
    expect(await rowCount(userId)).toBe(2);
  });

  it('keeps the global and per-hub scopes of one key independent', async () => {
    const userId = await seedUser('onboard-d');
    const guildId = await seedGuild('Hub Scope');

    await onboarding.dismiss(staff(userId), CHECKLIST, {});
    await onboarding.dismiss(staff(userId), CHECKLIST, {
      guildId: String(guildId),
    });
    await onboarding.restore(staff(userId), CHECKLIST, {
      guildId: String(guildId),
    });

    const state = await onboarding.getState(userId);
    expect(state.dismissed).toHaveLength(1);
    expect(state.dismissed[0]?.guildId).toBeNull();
  });

  it('undoes a dismissal, and undoing twice is a no-op', async () => {
    const userId = await seedUser('onboard-e');

    await onboarding.dismiss(staff(userId), CARD, {});
    expect(await onboarding.restore(staff(userId), CARD, {})).toEqual({
      dismissed: [],
    });
    expect(await onboarding.restore(staff(userId), CARD, {})).toEqual({
      dismissed: [],
    });
  });
});

describe('HubOnboardingService scoping (integration)', () => {
  it('never shows or touches another user rows', async () => {
    const mine = await seedUser('onboard-mine');
    const theirs = await seedUser('onboard-theirs');

    await onboarding.dismiss(staff(theirs), CARD, {});

    expect(await onboarding.getState(mine)).toEqual({ dismissed: [] });

    // My "undo" of the same key must not delete their row.
    await onboarding.restore(staff(mine), CARD, {});
    expect(await rowCount(theirs)).toBe(1);
  });

  it('refuses an unknown key before writing anything', async () => {
    const userId = await seedUser('onboard-f');

    await expect(
      onboarding.dismiss(staff(userId), 'not-a-prompt', {}),
    ).rejects.toThrow(BadRequestException);
    expect(await rowCount(userId)).toBe(0);
  });
});

/**
 * PR-3 review + Codex P2: `?guildId=` is caller-supplied, so a scoped
 * dismissal is an authorization decision, not just a write.
 */
/** A user linked by GUID to a guild_members row; optionally an editor. */
async function seedGuildMember(
  guildId: number,
  username: string,
  opts: { editor: boolean },
): Promise<GuildActor> {
  const userId = await seedUser(username);
  const guid = `Player-1-${username}`;
  await testApp.db.insert(schema.characters).values({
    userId,
    gameId: testApp.seed.game.id,
    name: username,
    addonGuid: guid,
    region: 'us',
  });
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.guildMembers)
      .values({
        guildId,
        guid,
        characterName: username,
        rankIndex: 3,
        rankName: 'Rank 3',
        source: 'addon_import',
        lastSeenAt: new Date(),
      })
      .returning(),
    'guild member',
  );
  if (opts.editor) {
    await testApp.db
      .insert(schema.guildEditors)
      .values({ guildId, kind: 'member', guildMemberId: row.id });
  }
  return { id: userId, role: 'member' };
}

describe('HubOnboardingService scope authorization (integration)', () => {
  it('answers 404 for a guild that does not exist, not an FK 500', async () => {
    const userId = await seedUser('onboard-ghost');

    await expect(
      onboarding.dismiss(member(userId), CARD, { guildId: '987654' }),
    ).rejects.toThrow(NotFoundException);
    expect(await rowCount(userId)).toBe(0);
  });

  // The two refusals must be indistinguishable, or the status code tells an
  // outsider which guild ids exist (Codex P3, PR-3).
  it('answers the same 404 for a guild that exists but the caller cannot see', async () => {
    const guildId = await seedGuild('Closed Hub');
    const outsiderId = await seedUser('onboard-outsider');

    await expect(
      onboarding.dismiss(member(outsiderId), CARD, {
        guildId: String(guildId),
      }),
    ).rejects.toThrow(NotFoundException);
    expect(await rowCount(outsiderId)).toBe(0);
  });

  it('lets an Officer dismiss the checklist but not a plain member', async () => {
    const guildId = await seedGuild('Ladder Hub');
    const officer = await seedGuildMember(guildId, 'onboard-officer', {
      editor: true,
    });
    const plain = await seedGuildMember(guildId, 'onboard-plain', {
      editor: false,
    });

    const after = await onboarding.dismiss(officer, CHECKLIST, {
      guildId: String(guildId),
    });
    expect(after.dismissed).toHaveLength(1);
    expect(after.dismissed[0]?.guildId).toBe(guildId);

    await expect(
      onboarding.dismiss(plain, CHECKLIST, { guildId: String(guildId) }),
    ).rejects.toThrow(ForbiddenException);
    expect(await rowCount(plain.id)).toBe(0);

    // A member may still dismiss a VIEW-scoped prompt on the same hub.
    const card = await onboarding.dismiss(plain, CARD, {
      guildId: String(guildId),
    });
    expect(card.dismissed).toHaveLength(1);
  });
});

/**
 * PR-3 review: every case above talks to the service. These two go through
 * the real HTTP stack, so deleting `@UseGuards(AuthGuard('jwt'))` or reading
 * the user id from anywhere but `req.user` turns them red.
 */
describe('GET /guilds/onboarding (HTTP)', () => {
  async function seedLogin(username: string): Promise<{
    id: number;
    token: string;
  }> {
    const id = await seedUser(username);
    const email = `${username}@onboarding.test`;
    await testApp.db.insert(schema.localCredentials).values({
      email,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      userId: id,
    });
    const res = await testApp.request
      .post('/auth/local')
      .send({ email, password: PASSWORD });
    expect(res.status).toBe(201);
    const token = (res.body as { access_token?: string }).access_token;
    if (typeof token !== 'string') {
      throw new Error(`no access_token in login response for ${username}`);
    }
    return { id, token };
  }

  it('refuses an anonymous caller', async () => {
    const res = await testApp.request.get('/guilds/onboarding');
    expect(res.status).toBe(401);
  });

  it('returns the bearer own rows only, never another user', async () => {
    const mine = await seedLogin('http-mine');
    const theirs = await seedLogin('http-theirs');
    await onboarding.dismiss(staff(theirs.id), CARD, {});

    const res = await testApp.request
      .get('/guilds/onboarding')
      .set('Authorization', `Bearer ${mine.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ dismissed: [] });

    const own = await testApp.request
      .post(`/guilds/onboarding/${CARD}/dismiss`)
      .set('Authorization', `Bearer ${mine.token}`);
    expect(own.status).toBe(200);
    expect((own.body as { dismissed: unknown[] }).dismissed).toHaveLength(1);
    expect(await rowCount(theirs.id)).toBe(1);
  });
});
