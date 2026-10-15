/**
 * ROK-1785 — GuildAccessService against a real database: D3 membership
 * (GUID link, soft removal via the latest snapshot, deactivated users) and
 * the canEdit / canManageEditors matrix with real `guild_editors` grants.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { GuildAccessService, type GuildActor } from './guild-access.service';

const SNAP = new Date('2026-10-10T20:00:00.000Z');
const OLD = new Date('2026-09-01T20:00:00.000Z');

let testApp: TestApp;
let access: GuildAccessService;

beforeAll(async () => {
  testApp = await getTestApp();
  access = testApp.app.get(GuildAccessService);
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

async function seedGuild(name: string): Promise<number> {
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

interface MemberOpts {
  guildId: number;
  username: string;
  rankIndex: number;
  seenAt?: Date;
  /** The character's region; omitted = 'us' (the seeded guild's region). */
  charRegion?: string | null;
}

/** A user + character + guild_members row linked by GUID. */
async function seedMember(o: MemberOpts) {
  const guid = `Player-1-${o.username}`;
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${o.username}`, username: o.username })
      .returning(),
    'user',
  );
  await testApp.db.insert(schema.characters).values({
    userId: user.id,
    gameId: testApp.seed.game.id,
    name: o.username,
    addonGuid: guid,
    region: o.charRegion === undefined ? 'us' : o.charRegion,
  });
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.guildMembers)
      .values({
        guildId: o.guildId,
        guid,
        characterName: o.username,
        rankIndex: o.rankIndex,
        rankName: `Rank ${o.rankIndex}`,
        source: 'addon_import',
        lastSeenAt: o.seenAt ?? SNAP,
      })
      .returning(),
    'guild member',
  );
  const actor: GuildActor = { id: user.id, role: 'member' };
  return { actor, memberId: row.id };
}

async function rights(a: GuildActor, guildId: number) {
  return {
    view: await access.canView(a, guildId),
    edit: await access.canEdit(a, guildId),
    manage: await access.canManageEditors(a, guildId),
  };
}

describe('GuildAccessService (real DB)', () => {
  it('GM, delegated rank, delegated member and plain member', async () => {
    const guildId = await seedGuild('Ironforge Watch');
    const gm = await seedMember({ guildId, username: 'gm', rankIndex: 0 });
    const officer = await seedMember({
      guildId,
      username: 'off',
      rankIndex: 1,
    });
    const picked = await seedMember({
      guildId,
      username: 'pick',
      rankIndex: 4,
    });
    const plain = await seedMember({
      guildId,
      username: 'raider',
      rankIndex: 4,
    });
    await testApp.db.insert(schema.guildEditors).values([
      { guildId, kind: 'rank', rankIndex: 1 },
      { guildId, kind: 'member', guildMemberId: picked.memberId },
    ]);

    const editor = { view: true, edit: true, manage: false };
    // GM_RANK_IMPLIES_EDIT is off: rank 0 alone is view-only.
    expect(await rights(gm.actor, guildId)).toEqual({
      view: true,
      edit: false,
      manage: false,
    });
    expect(await rights(officer.actor, guildId)).toEqual(editor);
    expect(await rights(picked.actor, guildId)).toEqual(editor);
    expect(await rights(plain.actor, guildId)).toEqual({
      view: true,
      edit: false,
      manage: false,
    });
  });

  it('a GM with an explicit member grant edits but never manages editors', async () => {
    const guildId = await seedGuild('Stormwind Keep');
    const gm = await seedMember({ guildId, username: 'gm2', rankIndex: 0 });
    await testApp.db
      .insert(schema.guildEditors)
      .values({ guildId, kind: 'member', guildMemberId: gm.memberId });
    expect(await rights(gm.actor, guildId)).toEqual({
      view: true,
      edit: true,
      manage: false,
    });
  });

  it('a soft-removed GM (not in the latest snapshot) loses every right', async () => {
    const guildId = await seedGuild('Gnomeregan Exiles');
    const gone = await seedMember({
      guildId,
      username: 'oldgm',
      rankIndex: 0,
      seenAt: OLD,
    });
    expect(await access.isMember(gone.actor.id, guildId)).toBe(false);
    expect(await rights(gone.actor, guildId)).toEqual({
      view: false,
      edit: false,
      manage: false,
    });
  });

  it('a deactivated user is not a member', async () => {
    const guildId = await seedGuild('Darnassus Wardens');
    const gm = await seedMember({ guildId, username: 'left', rankIndex: 0 });
    await testApp.db
      .insert(schema.guildEditors)
      .values({ guildId, kind: 'member', guildMemberId: gm.memberId });
    expect(await access.canEdit(gm.actor, guildId)).toBe(true);
    await testApp.db
      .update(schema.users)
      .set({ deactivatedAt: new Date() })
      .where(eq(schema.users.id, gm.actor.id));
    expect(await access.isMember(gm.actor.id, guildId)).toBe(false);
    expect(await access.canView(gm.actor, guildId)).toBe(false);
    expect(await access.canEdit(gm.actor, guildId)).toBe(false);
    expect(await access.myGuilds(gm.actor.id)).toEqual([]);
  });

  it('membership is per guild; admin/operator edit any guild', async () => {
    const mine = await seedGuild('Home Guild');
    const other = await seedGuild('Other Guild');
    const m = await seedMember({
      guildId: mine,
      username: 'solo',
      rankIndex: 0,
    });
    expect(await access.isMember(m.actor.id, other)).toBe(false);
    expect(await access.canEdit(m.actor, other)).toBe(false);
    const admin: GuildActor = { id: testApp.seed.adminUser.id, role: 'admin' };
    expect(await access.canEdit(admin, other)).toBe(true);
    expect(await access.canEdit({ ...m.actor, role: 'operator' }, other)).toBe(
      true,
    );
    expect((await access.myGuilds(m.actor.id)).map((g) => g.name)).toEqual([
      'Home Guild',
    ]);
  });
});

describe('GuildAccessService membership region (real DB)', () => {
  it('a same-GUID character in another region is not a member', async () => {
    const guildId = await seedGuild('Region Guard');
    const eu = await seedMember({
      guildId,
      username: 'euclone',
      rankIndex: 0,
      charRegion: 'eu',
    });
    expect(await access.isMember(eu.actor.id, guildId)).toBe(false);
    expect(await access.canView(eu.actor, guildId)).toBe(false);
    expect(await access.myGuilds(eu.actor.id)).toEqual([]);
  });

  it('a character with an unknown (NULL) region still links by GUID + game', async () => {
    const guildId = await seedGuild('Region Unknown');
    const m = await seedMember({
      guildId,
      username: 'noregion',
      rankIndex: 3,
      charRegion: null,
    });
    expect(await access.isMember(m.actor.id, guildId)).toBe(true);
    expect((await access.myGuilds(m.actor.id)).map((g) => g.name)).toEqual([
      'Region Unknown',
    ]);
  });

  it('region matching ignores case (guild "us", character "US")', async () => {
    const guildId = await seedGuild('Region Case');
    const m = await seedMember({
      guildId,
      username: 'upper',
      rankIndex: 3,
      charRegion: 'US',
    });
    expect(await access.isMember(m.actor.id, guildId)).toBe(true);
  });
});
