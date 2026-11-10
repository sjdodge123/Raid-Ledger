/**
 * ROK-2160 backfill (migration 0294) — owners deactivated BEFORE the release
 * never got the `guid_released` link audit the app now writes at deactivation.
 * Once `ownerActive` ships, their roster row links to the Blizzard-id
 * character instead, which would make the old holder's member grant count for
 * the new winner. Seeds that OLD shape (deactivated holder, grant, no audit,
 * a second Blizzard-id holder), runs the migration SQL, and checks the grant
 * does not move, a re-run changes nothing, and the grant is A's again on
 * reactivation.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { UsersService } from '../../../users/users.service';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { hasConfirmedMemberGrant } from './guild-delegation.helpers';
import { findLinkedMemberRows } from './guild-membership.helpers';

const FOREVER_SLUG = 'world-of-warcraft-forever';
const MIGRATION = '0294_guid_release_backfill_deactivated_owners.sql';
const DAY = 86_400_000;
const NOW = Date.now();
const T0 = new Date(NOW - 8 * DAY); // characters created
const T1 = new Date(NOW - 6 * DAY); // staff grant for A
const T2 = new Date(NOW - 4 * DAY); // A deactivated (pre-release, no audit)
const SNAP = new Date(NOW - DAY);

let testApp: TestApp;
let foreverId: number;
let seq = 0;
const next = (): number => {
  seq += 1;
  return seq;
};

async function ensureGame(): Promise<number> {
  const [found] = await testApp.db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.slug, FOREVER_SLUG));
  if (found) return found.id;
  const [made] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'World of Warcraft: Forever', slug: FOREVER_SLUG })
      .returning({ id: schema.games.id }),
    'game',
  );
  return made.id;
}

async function insertGuild(): Promise<number> {
  const name = `Backfill 2160 ${next()}`;
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: foreverId,
        region: 'us',
        name,
        nameKey: name.toLowerCase(),
        source: 'addon_import',
        lastSnapshotAt: SNAP,
      })
      .returning({ id: schema.guilds.id }),
    'guild',
  );
  return g.id;
}

async function insertUser(deactivatedAt: Date | null): Promise<number> {
  const n = next();
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:backfill-2160-${n}@test`,
        username: `Backfill2160_${n}`,
        role: 'member',
        deactivatedAt,
      })
      .returning({ id: schema.users.id }),
    'user',
  );
  return u.id;
}

async function insertChar(
  userId: number,
  o: { externalId?: string; addonGuid?: string },
): Promise<string> {
  const [c] = nonEmpty(
    await testApp.db
      .insert(schema.characters)
      .values({
        userId,
        gameId: foreverId,
        name: `BackfillChar${next()}`,
        role: 'dps',
        isMain: false,
        region: 'us',
        externalId: o.externalId ?? null,
        addonGuid: o.addonGuid ?? null,
        createdAt: T0,
      })
      .returning({ id: schema.characters.id }),
    'character',
  );
  return c.id;
}

/**
 * OLD shape: row R (GUID G + Blizzard id X) with a staff grant made for A,
 * A's character holds G, B's Armory character carries X, and A was
 * deactivated (or not, for the control) with NO link audit written.
 */
async function seed(aDeactivatedAt: Date | null) {
  const guildId = await insertGuild();
  const id = 930_000_000 + next();
  const guid = `Player-2160b-${next()}`;
  const [m] = nonEmpty(
    await testApp.db
      .insert(schema.guildMembers)
      .values({
        guildId,
        guid,
        blizzardCharacterId: id,
        characterName: `BackfillRow${next()}`,
        rankIndex: 3,
        rankName: 'Member',
        source: 'addon_import',
        lastSeenAt: SNAP,
      })
      .returning({ id: schema.guildMembers.id }),
    'member row',
  );
  const ownerA = await insertUser(aDeactivatedAt);
  const charA = await insertChar(ownerA, { addonGuid: guid });
  const ownerB = await insertUser(null);
  const charB = await insertChar(ownerB, { externalId: String(id) });
  await testApp.db.insert(schema.guildEditors).values({
    guildId,
    kind: 'member',
    guildMemberId: m.id,
    createdAt: T1,
  });
  return { guildId, memberId: m.id, ownerA, charA, ownerB, charB };
}

type Seed = Awaited<ReturnType<typeof seed>>;

async function granted(userId: number, s: Seed, via: 'guid' | 'blizzard') {
  const rows = await findLinkedMemberRows(testApp.db, userId, s.guildId);
  expect(rows.map((r) => [r.via, r.memberId])).toEqual([[via, s.memberId]]);
  return hasConfirmedMemberGrant(testApp.db, s.guildId, rows);
}

async function linkAudits(ownerId: number) {
  return testApp.db
    .select()
    .from(schema.activityLog)
    .where(
      and(
        eq(schema.activityLog.entityType, 'addon_guid'),
        inArray(schema.activityLog.action, [
          'addon_guid_claimed',
          'external_id_linked',
        ]),
        eq(schema.activityLog.entityId, ownerId),
      ),
    );
}

async function runBackfill(): Promise<void> {
  const file = join(__dirname, '../../../drizzle/migrations', MIGRATION);
  const statements = readFileSync(file, 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const statement of statements) {
    await testApp.db.execute(sql.raw(statement));
  }
}

beforeAll(async () => {
  testApp = await getTestApp();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  foreverId = await ensureGame();
});

// No truncate here: the shared integration setup closes the pool in its own
// afterAll, and the next spec truncates in beforeAll.

describe('ROK-2160 migration 0294: backfill for already-deactivated holders', () => {
  it('B never inherits A grant; a re-run is a no-op; A gets it back on return', async () => {
    const s = await seed(T2);
    const control = await seed(null);
    // The hazard the backfill closes: with no audit, B inherits A's grant.
    expect(await granted(s.ownerB, s, 'blizzard')).toBe(true);

    await runBackfill();
    expect(await granted(s.ownerB, s, 'blizzard')).toBe(false);
    const audits = await linkAudits(s.ownerB);
    expect(audits.map((a) => [a.action, a.actorId, a.metadata])).toEqual([
      [
        'external_id_linked',
        null,
        expect.objectContaining({
          characterId: s.charB,
          ownerId: s.ownerB,
          via: 'guid_released',
          backfill: 'rok-2160',
        }),
      ],
    ]);
    expect(await linkAudits(s.ownerA)).toEqual([]);
    // Control: an ACTIVE holder keeps the row; nothing written for its B.
    expect(await granted(control.ownerA, control, 'guid')).toBe(true);
    expect(await linkAudits(control.ownerB)).toEqual([]);

    await runBackfill();
    expect(await linkAudits(s.ownerB)).toHaveLength(1);
    expect(await granted(s.ownerB, s, 'blizzard')).toBe(false);

    // A returns: no grant was made while away, so A's own grant holds.
    await testApp.app.get(UsersService).reactivateUser(s.ownerA);
    expect(await granted(s.ownerA, s, 'guid')).toBe(true);
  });
});
