/**
 * ROK-1919 — `GET /plugins/wow/guilds/:id/recent-dings` against a real DB:
 * contract parse, visitor-visible (D7), the 30-day read window (a 31-day-old
 * row is excluded but kept — the log is never pruned), newest-first order,
 * the 20-row limit, the character link, and the hidden-hub 404.
 */
import * as bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { WowRecentDingsSchema } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../../common/testing/test-app';
import { nonEmpty } from '../../../../common/testing/narrow';
import * as schema from '../../../../drizzle/schema';
import { PluginRegistryService } from '../../../plugin-host/plugin-registry.service';
import { RECENT_DINGS_LIMIT } from './recent-dings.helpers';

type Who = 'member' | 'visitor';
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

let testApp: TestApp;
const tokens = {} as Record<Who, string>;
let memberCharId = '';

async function insertGuild(name: string): Promise<number> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: testApp.seed.game.id,
        region: 'us',
        name,
        nameKey: name.toLowerCase(),
        source: 'addon_import',
        lastSnapshotAt: new Date(),
      })
      .returning(),
    'guild',
  );
  return g.id;
}

async function insertMember(guildId: number, guid: string, name: string) {
  const [m] = nonEmpty(
    await testApp.db
      .insert(schema.guildMembers)
      .values({
        guildId,
        guid,
        characterName: name,
        level: 60,
        class: 'Warrior',
        rankIndex: 2,
        rankName: 'Raider',
        source: 'addon_import',
        lastSeenAt: new Date(),
      })
      .returning(),
    'member',
  );
  return m.id;
}

async function insertDing(
  guildId: number,
  guildMemberId: number,
  toLevel: number,
  occurredAt: Date,
) {
  await testApp.db.insert(schema.guildMemberLevelEvents).values({
    guildId,
    guildMemberId,
    fromLevel: toLevel - 1,
    toLevel,
    occurredAt,
  });
}

/** A local-login user + Forever character carrying `guid`; returns the character id. */
async function seedUser(who: Who, guid: string): Promise<string> {
  const email = `${who}@dings.test`;
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${email}`, username: `dings-${who}` })
      .returning(),
    'user',
  );
  await testApp.db.insert(schema.localCredentials).values({
    email,
    passwordHash: await bcrypt.hash('TestPassword123!', 4),
    userId: user.id,
  });
  const [char] = nonEmpty(
    await testApp.db
      .insert(schema.characters)
      .values({
        userId: user.id,
        gameId: testApp.seed.game.id,
        name: `Dings${who}`,
        addonGuid: guid,
        gameVariant: 'wow_forever',
        ruleset: 'normal',
        isMain: true,
      })
      .returning(),
    'character',
  );
  const res = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });
  tokens[who] = res.body.access_token as string;
  return char.id;
}

const dings = (who: Who, gid: number) =>
  testApp.request
    .get(`/plugins/wow/guilds/${gid}/recent-dings`)
    .set('Authorization', `Bearer ${tokens[who]}`);

beforeAll(async () => {
  testApp = await getTestApp();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  memberCharId = await seedUser('member', 'Player-9-dmember');
  await seedUser('visitor', 'Player-9-dvisitor');
});

describe('GET recent-dings (real DB)', () => {
  it('returns last-30-day dings newest first; a 31-day-old row is excluded but kept', async () => {
    const gid = await insertGuild('Dings Window');
    const linked = await insertMember(gid, 'Player-9-dmember', 'Linked');
    const pug = await insertMember(gid, 'Player-9-dpug', 'Pug');
    await insertDing(gid, pug, 20, ago(3));
    await insertDing(gid, linked, 41, ago(1));
    await insertDing(gid, pug, 30, ago(31));

    const res = await dings('member', gid);
    expect(res.status).toBe(200);
    const dto = WowRecentDingsSchema.parse(res.body);
    expect(dto.dings.map((d) => [d.name, d.toLevel, d.characterId])).toEqual([
      ['Linked', 41, memberCharId],
      ['Pug', 20, null],
    ]);
    const kept = await testApp.db
      .select()
      .from(schema.guildMemberLevelEvents)
      .where(eq(schema.guildMemberLevelEvents.guildId, gid));
    expect(kept).toHaveLength(3);
  });

  it('a visitor (not on the roster) sees the same feed', async () => {
    const gid = await insertGuild('Dings Visitor');
    const m = await insertMember(gid, 'Player-9-dother', 'Other');
    await insertDing(gid, m, 12, ago(2));
    const res = await dings('visitor', gid);
    expect(res.status).toBe(200);
    expect(WowRecentDingsSchema.parse(res.body).dings).toEqual([
      expect.objectContaining({ name: 'Other', fromLevel: 11, toLevel: 12 }),
    ]);
  });

  it(`caps the feed at ${RECENT_DINGS_LIMIT}, keeping the newest`, async () => {
    const gid = await insertGuild('Dings Limit');
    const m = await insertMember(gid, 'Player-9-dmany', 'Many');
    for (let lvl = 2; lvl <= RECENT_DINGS_LIMIT + 6; lvl++) {
      await insertDing(
        gid,
        m,
        lvl,
        new Date(Date.now() - (100 - lvl) * 60_000),
      );
    }
    const dto = WowRecentDingsSchema.parse((await dings('member', gid)).body);
    expect(dto.dings).toHaveLength(RECENT_DINGS_LIMIT);
    expect(dto.dings[0]?.toLevel).toBe(RECENT_DINGS_LIMIT + 6);
    expect(dto.dings.at(-1)?.toLevel).toBe(7);
  });

  it('an empty guild returns an empty list', async () => {
    const gid = await insertGuild('Dings Empty');
    expect((await dings('visitor', gid)).body).toEqual({ dings: [] });
  });
});

describe('GET recent-dings access (real DB)', () => {
  it('a hidden hub is 404 for a non-staff viewer', async () => {
    const gid = await insertGuild('Dings Hidden');
    await testApp.db
      .update(schema.guilds)
      .set({ hiddenAt: new Date() })
      .where(eq(schema.guilds.id, gid));
    expect((await dings('member', gid)).status).toBe(404);
    expect((await dings('visitor', gid)).status).toBe(404);
  });
});
