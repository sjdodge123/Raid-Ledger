/**
 * ROK-1787 — tagging events to a guild (events.guild_id) through the real
 * HTTP stack: EventGuildTagService → EVENT_GUILD_TAGGER → GuildEventTagger →
 * GuildAccessService.canEdit. GM has no implicit rights; editors are grants.
 */
import * as bcrypt from 'bcrypt';
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { loginAsAdmin } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';

const SNAP = new Date('2026-10-10T20:00:00.000Z');
type Who = 'officer' | 'gm' | 'plain' | 'outsider';

let testApp: TestApp;
let guildId: number;
let otherGameGuildId: number;
let otherGameId: number;
const tokens = {} as Record<Who | 'admin', string>;

async function insertGuild(name: string, gameId: number): Promise<number> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId,
        region: 'us',
        name,
        nameKey: name.toLowerCase(),
        source: 'addon_import',
        lastSnapshotAt: SNAP,
      })
      .returning(),
    'guild',
  );
  return g.id;
}

async function seedUser(who: Who, rankIndex: number | null): Promise<void> {
  const email = `${who}@tag.test`;
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${email}`, username: who, role: 'member' })
      .returning(),
    'user',
  );
  await testApp.db.insert(schema.localCredentials).values({
    email,
    passwordHash: await bcrypt.hash('TestPassword123!', 4),
    userId: user.id,
  });
  const guid = `Player-1-${who}`;
  await testApp.db.insert(schema.characters).values({
    userId: user.id,
    gameId: testApp.seed.game.id,
    name: who,
    addonGuid: guid,
    role: 'dps',
    isMain: true,
  });
  if (rankIndex !== null) {
    await testApp.db.insert(schema.guildMembers).values({
      guildId,
      guid,
      characterName: who,
      rankIndex,
      rankName: `Rank ${rankIndex}`,
      source: 'addon_import',
      lastSeenAt: SNAP,
    });
  }
  const res = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });
  tokens[who] = res.body.access_token as string;
}

function body(extra: Record<string, unknown> = {}) {
  return {
    title: 'Guild raid',
    startTime: '2027-01-05T19:00:00.000Z',
    endTime: '2027-01-05T22:00:00.000Z',
    gameId: testApp.seed.game.id,
    ...extra,
  };
}

const post = (who: Who | 'admin', payload: Record<string, unknown>) =>
  testApp.request
    .post('/events')
    .set('Authorization', `Bearer ${tokens[who]}`)
    .send(payload);

const patch = (who: Who | 'admin', id: number, payload: object) =>
  testApp.request
    .patch(`/events/${id}`)
    .set('Authorization', `Bearer ${tokens[who]}`)
    .send(payload);

const patchSeries = (who: Who, id: number, data: object) =>
  testApp.request
    .patch(`/events/${id}/series`)
    .set('Authorization', `Bearer ${tokens[who]}`)
    .send({ scope: 'all', data });

const weekly = { frequency: 'weekly', until: '2027-01-27T23:00:00.000Z' };

async function storedGuildId(eventId: number): Promise<number | null> {
  const [row] = nonEmpty(
    await testApp.db
      .select({ guildId: schema.events.guildId })
      .from(schema.events)
      .where(eq(schema.events.id, eventId)),
    'event',
  );
  return row.guildId;
}

beforeAll(async () => {
  testApp = await getTestApp();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  guildId = await insertGuild('Tag Keepers', testApp.seed.game.id);
  const [otherGame] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'Other Game 1787', slug: 'other-game-1787' })
      .returning(),
    'game',
  );
  otherGameId = otherGame.id;
  otherGameGuildId = await insertGuild('Elsewhere', otherGame.id);
  await seedUser('officer', 1);
  await seedUser('gm', 0);
  await seedUser('plain', 3);
  await seedUser('outsider', null);
  // ROK-1794: rank grants are inert — grant the rank-1 member row directly.
  const [officerRow] = nonEmpty(
    await testApp.db
      .select({ id: schema.guildMembers.id })
      .from(schema.guildMembers)
      .where(
        and(
          eq(schema.guildMembers.guildId, guildId),
          eq(schema.guildMembers.rankIndex, 1),
        ),
      ),
    'officer member row',
  );
  await testApp.db.insert(schema.guildEditors).values({
    guildId,
    kind: 'member',
    guildMemberId: officerRow.id,
  });
  tokens.admin = await loginAsAdmin(testApp.request, testApp.seed);
});

describe('POST /events with guildId', () => {
  it('editor via member grant → 201, guild_id stored and returned', async () => {
    const res = await post('officer', body({ guildId }));
    expect(res.status).toBe(201);
    expect(res.body.guildId).toBe(guildId);
    expect(await storedGuildId(res.body.id as number)).toBe(guildId);
  });

  it('recurring create tags every instance', async () => {
    const recurrence = {
      frequency: 'weekly',
      until: '2027-01-27T23:00:00.000Z',
    };
    const res = await post('officer', body({ guildId, recurrence }));
    expect(res.status).toBe(201);
    const group = res.body.recurrenceGroupId as string;
    const rows = await testApp.db
      .select({ guildId: schema.events.guildId })
      .from(schema.events)
      .where(eq(schema.events.recurrenceGroupId, group));
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.map((r) => r.guildId)).toEqual(rows.map(() => guildId));
  });

  it.each(['gm', 'plain', 'outsider'] as const)(
    '%s (no editor grant) → 403',
    async (who) => {
      expect((await post(who, body({ guildId }))).status).toBe(403);
    },
  );

  it('admin without membership → 201', async () => {
    const res = await post('admin', body({ guildId }));
    expect(res.status).toBe(201);
    expect(res.body.guildId).toBe(guildId);
  });

  it('guild of another game → 400', async () => {
    const res = await post('admin', body({ guildId: otherGameGuildId }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('different game');
  });

  it('unknown guild → 400', async () => {
    const res = await post('admin', body({ guildId: 999999 }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('Guild not found');
  });
});

describe('PATCH /events/:id guildId', () => {
  it('null clears the tag', async () => {
    const created = await post('officer', body({ guildId }));
    const id = created.body.id as number;
    const res = await patch('officer', id, { guildId: null });
    expect(res.status).toBe(200);
    expect(await storedGuildId(id)).toBeNull();
  });

  it('non-editor tagging their own event → 403, tag unchanged', async () => {
    const created = await post('plain', body());
    const id = created.body.id as number;
    expect((await patch('plain', id, { guildId })).status).toBe(403);
    expect(await storedGuildId(id)).toBeNull();
  });

  it('deleting the guild sets guild_id NULL', async () => {
    const doomed = await insertGuild('Doomed', testApp.seed.game.id);
    const created = await post('admin', body({ guildId: doomed }));
    const id = created.body.id as number;
    expect(await storedGuildId(id)).toBe(doomed);
    await testApp.db.delete(schema.guilds).where(eq(schema.guilds.id, doomed));
    expect(await storedGuildId(id)).toBeNull();
  });
});

describe('PATCH /events/:id/series guildId', () => {
  it('non-editor tagging their own series → 403, tag unchanged', async () => {
    const created = await post('plain', body({ recurrence: weekly }));
    const id = created.body.id as number;
    expect((await patchSeries('plain', id, { guildId })).status).toBe(403);
    expect(await storedGuildId(id)).toBeNull();
  });

  it('a game change that strands the tag → 400, tag unchanged', async () => {
    const created = await post(
      'officer',
      body({ guildId, recurrence: weekly }),
    );
    const id = created.body.id as number;
    const res = await patchSeries('officer', id, { gameId: otherGameId });
    expect(res.status).toBe(400);
    expect(await storedGuildId(id)).toBe(guildId);
  });
});

describe('guild check vs ownership', () => {
  it('non-owner PATCH with a guildId gets the owner 403, not the guild answer', async () => {
    const created = await post('officer', body());
    const id = created.body.id as number;
    const res = await patch('plain', id, { guildId: otherGameGuildId });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('You can only update your own events');
  });
});
