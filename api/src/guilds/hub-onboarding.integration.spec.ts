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

/** ROK-2056 — the hub Overview's Companion prompt is a per-hub, member-dismissable key. */
describe('HubOnboardingService companion-install key (integration)', () => {
  it('lets a plain member dismiss companion-install for their hub only', async () => {
    const guildId = await seedGuild('Companion Hub');
    const other = await seedGuild('Other Hub');
    const plain = await seedGuildMember(guildId, 'onboard-companion', {
      editor: false,
    });

    const after = await onboarding.dismiss(plain, 'companion-install', {
      guildId: String(guildId),
    });

    expect(after.dismissed).toEqual([
      expect.objectContaining({ key: 'companion-install', guildId }),
    ]);
    expect(after.dismissed.some((d) => d.guildId === other)).toBe(false);
    expect(await rowCount(plain.id)).toBe(1);
  });

  it('still refuses an unknown key on the same hub', async () => {
    const guildId = await seedGuild('Companion Hub B');
    const plain = await seedGuildMember(guildId, 'onboard-companion-b', {
      editor: false,
    });

    await expect(
      onboarding.dismiss(plain, 'companion-install-typo', {
        guildId: String(guildId),
      }),
    ).rejects.toThrow(BadRequestException);
    expect(await rowCount(plain.id)).toBe(0);
  });
});

/**
 * ROK-2153 N4 — a `claim-character` dismissal can be narrowed to a provider
 * round (`?scope=`, a BG3 campaign). Each scope is its own row
 * (`claim-character:<scope>` in the key column), so dismissing campaign 1
 * leaves campaign 2's prompt free to show, while an unscoped dismissal keeps
 * working exactly as before (once per hub, permanent).
 */
const CLAIM = 'claim-character';

/** Raw `key` column values, so the `<key>:<scope>` encoding is pinned. */
async function storedKeys(userId: number): Promise<string[]> {
  const rows = await testApp.db
    .select({ key: schema.hubOnboardingDismissals.key })
    .from(schema.hubOnboardingDismissals)
    .where(eq(schema.hubOnboardingDismissals.userId, userId));
  return rows.map((r) => r.key).sort();
}

describe('HubOnboardingService scoped claim-character (integration)', () => {
  it('stores a scoped dismissal and lists it split back into key + scope', async () => {
    const guildId = await seedGuild('Scoped Hub');
    const plain = await seedGuildMember(guildId, 'scoped-a', { editor: false });
    const q = { guildId: String(guildId), scope: 'campaign-1' };

    await onboarding.dismiss(plain, CLAIM, q);
    const again = await onboarding.dismiss(plain, CLAIM, q);

    expect(again.dismissed).toEqual([
      expect.objectContaining({ key: CLAIM, guildId, scope: 'campaign-1' }),
    ]);
    expect(await storedKeys(plain.id)).toEqual(['claim-character:campaign-1']);
  });

  it('does not count a campaign-1 dismissal as a campaign-2 one', async () => {
    const guildId = await seedGuild('Two Campaigns');
    const plain = await seedGuildMember(guildId, 'scoped-b', { editor: false });

    const after = await onboarding.dismiss(plain, CLAIM, {
      guildId: String(guildId),
      scope: 'campaign-1',
    });

    const scopes = after.dismissed.map((d) => d.scope);
    expect(scopes).toEqual(['campaign-1']);
    expect(scopes).not.toContain('campaign-2');
  });

  it('keeps unscoped, campaign-1 and campaign-2 rows apart; restore removes one', async () => {
    const guildId = await seedGuild('Three Rows');
    const plain = await seedGuildMember(guildId, 'scoped-c', { editor: false });
    const g = String(guildId);
    await onboarding.dismiss(plain, CLAIM, { guildId: g });
    await onboarding.dismiss(plain, CLAIM, { guildId: g, scope: 'campaign-1' });
    await onboarding.dismiss(plain, CLAIM, { guildId: g, scope: 'campaign-2' });
    expect(await rowCount(plain.id)).toBe(3);

    const after = await onboarding.restore(plain, CLAIM, {
      guildId: g,
      scope: 'campaign-1',
    });

    expect(await storedKeys(plain.id)).toEqual([
      'claim-character',
      'claim-character:campaign-2',
    ]);
    const unscoped = after.dismissed.find((d) => d.scope === undefined);
    expect(unscoped).toEqual(expect.objectContaining({ key: CLAIM, guildId }));
    expect(unscoped).not.toHaveProperty('scope');
  });
});

describe('HubOnboardingService scoped claim-character refusals (integration)', () => {
  it('refuses a scope on another key, without guildId, or malformed — no row', async () => {
    const guildId = await seedGuild('Bad Scopes');
    const plain = await seedGuildMember(guildId, 'scoped-d', { editor: false });
    const g = String(guildId);
    const bad: Array<[string, Record<string, string>]> = [
      ['companion-install', { guildId: g, scope: 'campaign-1' }],
      [CLAIM, { scope: 'campaign-1' }],
      [CLAIM, { guildId: g, scope: 'a:b' }],
      [CLAIM, { guildId: g, scope: 'x'.repeat(41) }],
    ];
    for (const [key, query] of bad) {
      await expect(onboarding.dismiss(plain, key, query)).rejects.toThrow(
        BadRequestException,
      );
    }
    expect(await rowCount(plain.id)).toBe(0);
  });

  it('answers 404 for a scoped dismissal on a hub the caller cannot see', async () => {
    const guildId = await seedGuild('Hidden Scoped Hub');
    const outsiderId = await seedUser('scoped-outsider');

    await expect(
      onboarding.dismiss(member(outsiderId), CLAIM, {
        guildId: String(guildId),
        scope: 'campaign-1',
      }),
    ).rejects.toThrow(NotFoundException);
    expect(await rowCount(outsiderId)).toBe(0);
  });
});

/** A local-credential user and their bearer token. */
async function seedLogin(
  username: string,
  role: 'member' | 'admin' = 'member',
): Promise<{
  id: number;
  token: string;
}> {
  const id = await seedUser(username);
  if (role !== 'member') {
    await testApp.db
      .update(schema.users)
      .set({ role })
      .where(eq(schema.users.id, id));
  }
  const email = `${username}@onboarding.test`;
  await testApp.db.insert(schema.localCredentials).values({
    email,
    passwordHash: await bcrypt.hash(PASSWORD, 4),
    userId: id,
  });
  const res = await testApp.request
    .post('/auth/local')
    .send({ email, password: PASSWORD });
  // `/auth/local` answers 200, not Nest's POST-default 201 — same as
  // `auth.integration.spec.ts` and `loginAsAdmin` in integration-helpers.
  expect(res.status).toBe(200);
  const token = (res.body as { access_token?: string }).access_token;
  if (typeof token !== 'string') {
    throw new Error(`no access_token in login response for ${username}`);
  }
  return { id, token };
}

/**
 * PR-3 review: every case above talks to the service. These two go through
 * the real HTTP stack, so deleting `@UseGuards(AuthGuard('jwt'))` or reading
 * the user id from anywhere but `req.user` turns them red.
 */
describe('GET /guilds/onboarding (HTTP)', () => {
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

describe('POST /guilds/onboarding/claim-character/dismiss?scope= (HTTP)', () => {
  // ROK-2153 N4: `?scope=` travels through the controller's @Query().
  it('stores ?scope= over HTTP and 400s it without guildId', async () => {
    // Staff see every hub, so the hub needs no member seeding here.
    const mine = await seedLogin('http-scoped', 'admin');
    const guildId = await seedGuild('HTTP Scoped Hub');

    const bad = await testApp.request
      .post('/guilds/onboarding/claim-character/dismiss?scope=campaign-1')
      .set('Authorization', `Bearer ${mine.token}`);
    expect(bad.status).toBe(400);

    const res = await testApp.request
      .post(
        `/guilds/onboarding/claim-character/dismiss?guildId=${guildId}&scope=campaign-3`,
      )
      .set('Authorization', `Bearer ${mine.token}`);
    expect(res.status).toBe(200);
    expect((res.body as { dismissed: unknown[] }).dismissed).toContainEqual(
      expect.objectContaining({
        key: 'claim-character',
        guildId,
        scope: 'campaign-3',
      }),
    );
  });
});
