/**
 * ROK-1785 — GuildAccessService against a real database: D3 membership
 * (GUID link, soft removal via the latest snapshot, deactivated users) and
 * the canEdit / canManageEditors matrix with real `guild_editors` grants.
 */
import { eq, sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
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

/** The Postgres constraint a statement violated, or null when it succeeded. */
async function violatedConstraint(
  run: () => Promise<unknown>,
): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (e) {
    const src = e instanceof Error && e.cause !== undefined ? e.cause : e;
    if (typeof src === 'object' && src !== null && 'constraint_name' in src) {
      return String(src.constraint_name);
    }
    return e instanceof Error ? e.message : String(e);
  }
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
    // ROK-1794 AC1: a rank grant confers nothing (rank_index is unsigned).
    expect(await rights(officer.actor, guildId)).toEqual({
      view: true,
      edit: false,
      manage: false,
    });
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

describe('GuildAccessService ladder (ROK-1830, real DB)', () => {
  it('staff → leader, delegates → officer, members → member, outsider → visitor', async () => {
    const guildId = await seedGuild('Ladder Keep');
    const gm = await seedMember({ guildId, username: 'lgm', rankIndex: 0 });
    const rank = await seedMember({ guildId, username: 'lrk', rankIndex: 1 });
    const pick = await seedMember({ guildId, username: 'lpk', rankIndex: 4 });
    const plain = await seedMember({ guildId, username: 'lpl', rankIndex: 4 });
    const outsider = await seedMember({
      guildId: await seedGuild('Elsewhere'),
      username: 'lout',
      rankIndex: 4,
    });
    await testApp.db.insert(schema.guildEditors).values([
      { guildId, kind: 'rank', rankIndex: 1 },
      { guildId, kind: 'member', guildMemberId: pick.memberId },
    ]);
    const admin: GuildActor = { id: testApp.seed.adminUser.id, role: 'admin' };
    const cases: [string, GuildActor, string][] = [
      ['admin', admin, 'leader'],
      ['operator', { ...plain.actor, role: 'operator' }, 'leader'],
      ['rank delegate (ROK-1794: inert)', rank.actor, 'member'],
      ['member delegate', pick.actor, 'officer'],
      ['GM without a grant', gm.actor, 'member'],
      ['plain member', plain.actor, 'member'],
      ['outsider', outsider.actor, 'visitor'],
    ];
    for (const [who, a, want] of cases) {
      const got = await access.resolveLadder(a, guildId);
      expect({ who, role: got }).toEqual({ who, role: want });
      // The booleans stay derived from the ladder (no behaviour change).
      expect({ who, ...(await rights(a, guildId)) }).toMatchObject({
        who,
        edit: got === 'leader' || got === 'officer',
        manage: got === 'leader',
      });
    }
  });
});

describe('guilds.kind (ROK-1830, real DB)', () => {
  it('a guild inserted without a kind defaults to wow_guild', async () => {
    const guildId = await seedGuild('Default Kind');
    const [row] = await testApp.db
      .select({ kind: schema.guilds.kind })
      .from(schema.guilds)
      .where(eq(schema.guilds.id, guildId));
    expect(row).toEqual({ kind: 'wow_guild' });
    // The column itself carries the default, which is what backfilled every
    // pre-existing row in migration 0224 (NOT NULL DEFAULT in one statement).
    const cols = await testApp.db.execute(
      sql`SELECT column_default, is_nullable FROM information_schema.columns
          WHERE table_name = 'guilds' AND column_name = 'kind'`,
    );
    expect([...cols]).toEqual([
      {
        column_default: "'wow_guild'::character varying",
        is_nullable: 'NO',
      },
    ]);
  });

  it('the check constraint rejects an unknown kind', async () => {
    const guildId = await seedGuild('Strict Kind');
    const violated = await violatedConstraint(() =>
      testApp.db.execute(
        sql`UPDATE guilds SET kind = 'clan' WHERE id = ${guildId}`,
      ),
    );
    expect(violated).toBe('guilds_kind_check');
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

describe('ROK-1794 AC5 — a member grant follows the staff-confirmed link', () => {
  it('a GUID claimed after the grant (repin) confers no delegation', async () => {
    const guildId = await seedGuild('Repin Watch');
    const real = await seedMember({ guildId, username: 'rp1', rankIndex: 4 });
    await testApp.db
      .insert(schema.guildEditors)
      .values({ guildId, kind: 'member', guildMemberId: real.memberId });
    expect(await access.resolveLadder(real.actor, guildId)).toBe('officer');
    const [ch] = nonEmpty(
      await testApp.db
        .select({ id: schema.characters.id })
        .from(schema.characters)
        .where(eq(schema.characters.userId, real.actor.id)),
      'character',
    );
    await testApp.db.insert(schema.activityLog).values({
      entityType: 'addon_guid',
      entityId: real.actor.id,
      action: 'addon_guid_claimed',
      actorId: real.actor.id,
      metadata: { characterId: ch.id },
      createdAt: sql`now() + interval '1 second'`,
    });
    expect(await access.resolveLadder(real.actor, guildId)).toBe('member');
  });
});
