/**
 * ROK-1815 (review) — the guild page viewer's `isGuildMaster` label against a
 * real database, for the cases the view matrix in
 * `guilds.controller.integration.spec.ts` does not cover: a user with two
 * linked characters, and a rank-0 row that dropped out of the latest snapshot.
 */
import * as bcrypt from 'bcrypt';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';

const SNAP = new Date('2026-10-10T20:00:00.000Z');
const OLD = new Date('2026-09-01T20:00:00.000Z');

type Who = 'twoGm' | 'twoNoGm' | 'staleGm';

let testApp: TestApp;
let guildId: number;
const tokens = {} as Record<Who, string>;

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
        lastSnapshotAt: SNAP,
      })
      .returning(),
    'guild',
  );
  return g.id;
}

/** One linked character + its member row (`rankIndex`, last seen `seenAt`). */
async function linkCharacter(
  userId: number,
  name: string,
  rankIndex: number,
  seenAt: Date,
): Promise<void> {
  const guid = `Player-1815-${name}`;
  await testApp.db.insert(schema.characters).values({
    userId,
    gameId: testApp.seed.game.id,
    name,
    addonGuid: guid,
    role: 'dps',
    isMain: false,
  });
  await testApp.db.insert(schema.guildMembers).values({
    guildId,
    guid,
    characterName: name,
    rankIndex,
    rankName: `Rank ${rankIndex}`,
    source: 'addon_import',
    lastSeenAt: seenAt,
  });
}

/** A local-login user whose characters are `[name, rank, seenAt]` triples. */
async function seedUser(
  who: Who,
  chars: [string, number, Date][],
): Promise<void> {
  const email = `${who.toLowerCase()}@guild-viewer-gm.test`;
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
  for (const [name, rank, seenAt] of chars) {
    await linkCharacter(user.id, name, rank, seenAt);
  }
  const res = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });
  tokens[who] = res.body.access_token as string;
}

async function viewerOf(who: Who): Promise<Record<string, unknown>> {
  const res = await testApp.request
    .get(`/plugins/wow/guilds/${guildId}`)
    .set('Authorization', `Bearer ${tokens[who]}`);
  expect(res.status).toBe(200);
  return res.body.viewer as Record<string, unknown>;
}

beforeAll(async () => {
  testApp = await getTestApp();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  guildId = await insertGuild('Viewer GM Keepers 1815');
  await seedUser('twoGm', [
    ['TwoGmAlt', 3, SNAP],
    ['TwoGmMain', 0, SNAP],
  ]);
  await seedUser('twoNoGm', [
    ['TwoNoGmA', 3, SNAP],
    ['TwoNoGmB', 1, SNAP],
  ]);
  // Rank 0 in an OLD snapshot only; still a live member through a rank-3 alt.
  await seedUser('staleGm', [
    ['StaleGmOld', 0, OLD],
    ['StaleGmAlt', 3, SNAP],
  ]);
});

describe('GET /:id — viewer.isGuildMaster (ROK-1815)', () => {
  it('two linked characters, rank 0 on the second → isGuildMaster', async () => {
    const viewer = await viewerOf('twoGm');
    expect(
      viewer.isGuildMaster,
      'any live linked character at rank 0 makes the viewer the GM',
    ).toBe(true);
  });

  it('two linked characters, neither rank 0 → no isGuildMaster', async () => {
    const viewer = await viewerOf('twoNoGm');
    expect(
      viewer.isGuildMaster ?? false,
      'no rank-0 character, so no Guild Master label',
    ).toBe(false);
  });

  it('a rank-0 row missing from the latest snapshot → no isGuildMaster', async () => {
    const viewer = await viewerOf('staleGm');
    expect(viewer.role, 'still a member through the live alt').toBe('member');
    expect(
      viewer.isGuildMaster ?? false,
      'a stale rank-0 row (last_seen_at < last_snapshot_at) must not label the GM',
    ).toBe(false);
  });
});
