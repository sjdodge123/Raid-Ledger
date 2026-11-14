/**
 * ROK-1928 A — `PATCH /plugins/wow/guilds/:id/blizzard-roster` against a real
 * database: editor sets the slug, non-editor 403, non-Forever 404, invalid
 * slug 400, kill switch off 403. ROK-2192: the GUID-linked rank-0 GM sets it
 * too and reaches "Sync now"; a rank-1 member, a rank-0 row linked only by
 * Blizzard id, and the GM of another Forever guild stay 403.
 */
import * as bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { loginAsAdmin } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { WOW_FOREVER_ARMORY_IMPORT_KEY } from '../forever.settings';

const FOREVER_SLUG = 'world-of-warcraft-forever';
const url = (id: number): string => `/plugins/wow/guilds/${id}/blizzard-roster`;

let testApp: TestApp;
let adminToken: string;
let plainToken: string;
let foreverGuildId: number;
let otherGuildId: number;
let foreverGameId: number;
const SNAP = new Date('2026-11-13T20:00:00.000Z');

async function ensureGame(slug: string): Promise<number> {
  const [found] = await testApp.db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.slug, slug));
  if (found) return found.id;
  const [made] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'World of Warcraft: Forever', slug })
      .returning({ id: schema.games.id }),
    'game',
  );
  return made.id;
}

async function insertGuild(gameId: number, name: string): Promise<number> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId,
        region: 'us',
        name,
        nameKey: name.toLowerCase(),
        source: 'addon_import',
      })
      .returning({ id: schema.guilds.id }),
    'guild',
  );
  return g.id;
}

/** A local-login member account; returns its user id and access token. */
async function localMember(
  tag: string,
): Promise<{ userId: number; token: string }> {
  const email = `${tag}@roster.test`;
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${email}`, username: tag, role: 'member' })
      .returning(),
    'user',
  );
  await testApp.db.insert(schema.localCredentials).values({
    email,
    passwordHash: await bcrypt.hash('TestPassword123!', 4),
    userId: user.id,
  });
  const res = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });
  const token: unknown = res.body.access_token;
  if (typeof token !== 'string') throw new Error(`no access_token for ${tag}`);
  return { userId: user.id, token };
}

interface LinkOpts {
  /** Default: the main Forever guild. */
  guildId?: number;
  /** `guid` (default) = LedgerLink GUID; `blizzard` = Armory id only (ROK-2115). */
  via?: 'guid' | 'blizzard';
}

let blizzardIdSeq = 920_000_000;

/**
 * ROK-2192: a local-login member whose character links to a roster row of a
 * Forever guild at `rank` in its latest snapshot — by GUID, or (ROK-2115
 * Ruling 1) by Blizzard character id only.
 */
async function linkedMemberLogin(
  tag: string,
  rank: number,
  opts: LinkOpts = {},
): Promise<string> {
  const { userId, token } = await localMember(tag);
  const byGuid = (opts.via ?? 'guid') === 'guid';
  const guid = byGuid ? `Player-1-roster-${tag}` : null;
  const blizzardId = byGuid ? null : (blizzardIdSeq += 1);
  await testApp.db.insert(schema.characters).values({
    userId,
    gameId: foreverGameId,
    name: tag,
    region: 'us',
    addonGuid: guid,
    externalId: blizzardId === null ? null : String(blizzardId),
    role: 'dps',
    isMain: true,
  });
  await testApp.db.insert(schema.guildMembers).values({
    guildId: opts.guildId ?? foreverGuildId,
    guid,
    blizzardCharacterId: blizzardId,
    characterName: tag,
    rankIndex: rank,
    rankName: `Rank ${rank}`,
    source: byGuid ? 'addon_import' : 'blizzard',
    lastSeenAt: SNAP,
  });
  return token;
}

/** A second Forever guild (snapshot at SNAP, no slug) — the cross-hub cases. */
async function insertSecondForeverGuild(name: string): Promise<number> {
  const id = await insertGuild(foreverGameId, name);
  await testApp.db
    .update(schema.guilds)
    .set({ lastSnapshotAt: SNAP })
    .where(eq(schema.guilds.id, id));
  return id;
}

async function setSwitch(value: 'true' | 'false'): Promise<void> {
  const settings = testApp.app.get(SettingsService);
  await settings.set(WOW_FOREVER_ARMORY_IMPORT_KEY, value);
  settings.invalidateCache(true);
}

beforeAll(async () => {
  testApp = await getTestApp();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  foreverGameId = await ensureGame(FOREVER_SLUG);
  foreverGuildId = await insertGuild(foreverGameId, 'Ye Olde Guild');
  await testApp.db
    .update(schema.guilds)
    .set({ lastSnapshotAt: SNAP })
    .where(eq(schema.guilds.id, foreverGuildId));
  otherGuildId = await insertGuild(testApp.seed.game.id, 'Retail Guild');
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  // A plain member account: no editor grant, no linked character.
  plainToken = (await localMember('plain')).token;
});

// No truncate here: the shared integration setup closes the pool in its own
// afterAll, and the next spec truncates in beforeAll.

const patch = (id: number, token: string, body: Record<string, unknown>) =>
  testApp.request
    .patch(url(id))
    .set('Authorization', `Bearer ${token}`)
    .send(body);

describe('PATCH /plugins/wow/guilds/:id/blizzard-roster (ROK-1928)', () => {
  it('an editor sets the slug; the summary carries blizzardRoster', async () => {
    const res = await patch(foreverGuildId, adminToken, {
      guildSlug: 'ye-olde-guild',
    });
    expect(res.status).toBe(200);
    expect(res.body.blizzardRoster).toEqual({
      guildSlug: 'ye-olde-guild',
      status: null,
      syncedAt: null,
    });
    const [row] = await testApp.db
      .select({ slug: schema.guilds.guildSlug })
      .from(schema.guilds)
      .where(eq(schema.guilds.id, foreverGuildId));
    expect(row?.slug).toBe('ye-olde-guild');
  });

  it('null clears the slug (stop syncing)', async () => {
    const res = await patch(foreverGuildId, adminToken, { guildSlug: null });
    expect(res.status).toBe(200);
    expect(res.body.blizzardRoster?.guildSlug).toBeNull();
  });

  it('a non-editor gets 403', async () => {
    const res = await patch(foreverGuildId, plainToken, {
      guildSlug: 'ye-olde-guild',
    });
    expect(res.status).toBe(403);
  });

  it('a non-Forever guild is 404', async () => {
    const res = await patch(otherGuildId, adminToken, {
      guildSlug: 'retail-guild',
    });
    expect(res.status).toBe(404);
  });

  it('an invalid slug is 400', async () => {
    const res = await patch(foreverGuildId, adminToken, {
      guildSlug: 'has space',
    });
    expect(res.status).toBe(400);
  });

  it('the kill switch off is 403', async () => {
    await setSwitch('false');
    try {
      const res = await patch(foreverGuildId, adminToken, {
        guildSlug: 'ye-olde-guild',
      });
      expect(res.status).toBe(403);
    } finally {
      await setSwitch('true');
    }
  });
});

describe('PATCH blizzard-roster — the rank-0 GM (ROK-2192)', () => {
  it('ROK-2192: the GUID-linked rank-0 GM (no editor grant) sets the slug', async () => {
    const gmToken = await linkedMemberLogin('rostergm', 0);
    const res = await patch(foreverGuildId, gmToken, {
      guildSlug: 'ye-olde-guild',
    });
    expect(res.status).toBe(200);
    expect(res.body.blizzardRoster?.guildSlug).toBe('ye-olde-guild');
  });

  it('ROK-2192: a GUID-linked rank-1 member is still 403', async () => {
    const r1Token = await linkedMemberLogin('rosterr1', 1);
    const res = await patch(foreverGuildId, r1Token, {
      guildSlug: 'ye-olde-guild',
    });
    expect(res.status).toBe(403);
  });

  it('ROK-2192: a rank-0 row linked only by Blizzard id is 403 (GUID-only, ROK-2115 Ruling 1)', async () => {
    const token = await linkedMemberLogin('rosterbnet', 0, { via: 'blizzard' });
    const res = await patch(foreverGuildId, token, {
      guildSlug: 'ye-olde-guild',
    });
    expect(res.status).toBe(403);
  });

  it('ROK-2192: the GM of ANOTHER Forever guild is 403 here', async () => {
    const otherForever = await insertSecondForeverGuild('Other Forever Guild');
    const token = await linkedMemberLogin('rosterothergm', 0, {
      guildId: otherForever,
    });
    const res = await patch(foreverGuildId, token, {
      guildSlug: 'ye-olde-guild',
    });
    expect(res.status).toBe(403);
  });
});

describe('POST blizzard-roster/sync — the rank-0 GM (ROK-2192)', () => {
  it('ROK-2192: the GM gets past the guard (404 no slug, not 403)', async () => {
    const fresh = await insertSecondForeverGuild('Fresh Forever Guild');
    const token = await linkedMemberLogin('rostersyncgm', 0, {
      guildId: fresh,
    });
    const res = await testApp.request
      .post(`${url(fresh)}/sync`)
      .set('Authorization', `Bearer ${token}`);
    expect({ status: res.status, message: res.body.message }).toEqual({
      status: 404,
      message: 'No Blizzard guild slug is set',
    });
  });
});

const get = (id: number, token: string) =>
  testApp.request.get(url(id)).set('Authorization', `Bearer ${token}`);

describe('GET /plugins/wow/guilds/:id/blizzard-roster (ROK-1928)', () => {
  it('a non-editor member reads the slug, status and suggested slug', async () => {
    await patch(foreverGuildId, adminToken, { guildSlug: 'ye-olde-guild' });
    const res = await get(foreverGuildId, plainToken);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      guildSlug: 'ye-olde-guild',
      status: null,
      syncedAt: null,
      suggestedSlug: 'ye-olde-guild',
    });
  });

  it('a non-Forever guild is 404', async () => {
    const res = await get(otherGuildId, plainToken);
    expect(res.status).toBe(404);
  });

  it('no token is 401', async () => {
    const res = await testApp.request.get(url(foreverGuildId));
    expect(res.status).toBe(401);
  });
});
