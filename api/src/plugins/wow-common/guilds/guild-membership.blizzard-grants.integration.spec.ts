/**
 * ROK-2115 — ROK-1794 member grants and the ROK-1814 crest right over a
 * Blizzard-id-only link (`characters.external_id` ↔ a `source='blizzard'`
 * roster row, guid NULL), against a real database. Spec "Tests by tier":
 * case 7a (a grant made before an `external_id_linked` audit is not honoured,
 * one made after it is; `linkedSince` moves to the audit), case 7b (admin
 * Change owner of a Blizzard-only character re-audits the id link for the new
 * owner, so the old owner's grant is not inherited) and case 8 (Ruling 1:
 * a Blizzard-only rank-0 link never holds the top rank; a GUID one does).
 *
 * Timestamps sit DAYS apart: `characters.created_at` is a naive timestamp
 * compared against timestamptz grants, so a session-timezone shift must not
 * be able to reorder them.
 */
import { and, eq, sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { loginAsAdmin } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { logExternalIdLinked } from '../addon-import/external-id.audit';
import { hasConfirmedMemberGrant } from './guild-delegation.helpers';
import { findLinkedMemberRows } from './guild-membership.helpers';
import { loadRosterLinks } from './guild-roster-links.helpers';
import { loadRosterRows } from './guild-roster.helpers';
import { WowHubKindAdapter } from './wow-hub-kind.adapter';

const FOREVER_SLUG = 'world-of-warcraft-forever';
const DAY = 86_400_000;
const NOW = Date.now();
const T0 = new Date(NOW - 8 * DAY); // character created
const T1 = new Date(NOW - 6 * DAY); // first grant
const T2 = new Date(NOW - 4 * DAY); // external_id_linked audit
const T3 = new Date(NOW - 2 * DAY); // re-grant after the fresh link
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
  const name = `Blizzard Grants 2115 ${next()}`;
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

async function insertUser(): Promise<number> {
  const n = next();
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:blizzard-grants-2115-${n}@test`,
        username: `BlizzGrants2115_${n}`,
        role: 'member',
      })
      .returning({ id: schema.users.id }),
    'user',
  );
  return u.id;
}

interface CharOpts {
  externalId?: string;
  addonGuid?: string;
}

async function insertChar(userId: number, o: CharOpts): Promise<string> {
  const [c] = nonEmpty(
    await testApp.db
      .insert(schema.characters)
      .values({
        userId,
        gameId: foreverId,
        name: `GrantChar${next()}`,
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

interface RowOpts {
  guid?: string;
  blizzardId?: number;
  rankIndex?: number;
}

async function insertRow(guildId: number, o: RowOpts): Promise<number> {
  const [m] = nonEmpty(
    await testApp.db
      .insert(schema.guildMembers)
      .values({
        guildId,
        guid: o.guid ?? null,
        blizzardCharacterId: o.blizzardId ?? null,
        characterName: `GrantRow${next()}`,
        rankIndex: o.rankIndex ?? 3,
        rankName: o.rankIndex === 0 ? 'Guild Master' : 'Member',
        source: o.guid ? 'addon_import' : 'blizzard',
        lastSeenAt: SNAP,
      })
      .returning({ id: schema.guildMembers.id }),
    'member row',
  );
  return m.id;
}

async function grant(
  guildId: number,
  guildMemberId: number,
  at: Date,
): Promise<void> {
  await testApp.db
    .insert(schema.guildEditors)
    .values({ guildId, kind: 'member', guildMemberId, createdAt: at });
}

/** Staff re-grant: one grant per (guild, member) — revoke, then grant anew. */
async function regrant(
  guildId: number,
  guildMemberId: number,
  at: Date,
): Promise<void> {
  await testApp.db
    .delete(schema.guildEditors)
    .where(
      and(
        eq(schema.guildEditors.guildId, guildId),
        eq(schema.guildEditors.guildMemberId, guildMemberId),
      ),
    );
  await grant(guildId, guildMemberId, at);
}

const blizzardId = (): number => 910_000_000 + next();

/** A Blizzard-only link: Armory char (external_id X) ↔ guid-less row X. */
async function seedBlizzardLink(rankIndex = 3) {
  const guildId = await insertGuild();
  const userId = await insertUser();
  const id = blizzardId();
  const charId = await insertChar(userId, { externalId: String(id) });
  const memberId = await insertRow(guildId, { blizzardId: id, rankIndex });
  return { guildId, userId, charId, memberId, externalId: String(id) };
}

/** The user's link rows, failing loudly unless exactly the Blizzard arm. */
async function blizzardRows(userId: number, guildId: number) {
  const rows = await findLinkedMemberRows(testApp.db, userId, guildId);
  expect(rows.map((r) => r.via)).toEqual(['blizzard']);
  return rows;
}

async function linkedSince(guildId: number, charId: string): Promise<number> {
  const links = await loadRosterLinks(
    testApp.db,
    await loadRosterRows(testApp.db, guildId),
  );
  const link = links.get(charId);
  if (!link) throw new Error(`no roster link for character ${charId}`);
  return Date.parse(link.linkedSince);
}

async function idLinkAudits(ownerId: number) {
  return testApp.db
    .select()
    .from(schema.activityLog)
    .where(
      and(
        eq(schema.activityLog.entityType, 'addon_guid'),
        eq(schema.activityLog.action, 'external_id_linked'),
        eq(schema.activityLog.entityId, ownerId),
      ),
    );
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

describe('ROK-2115 case 7a: member grant vs an external_id_linked audit', () => {
  it('a grant made before the id link audit is not honoured; one made after it is', async () => {
    const s = await seedBlizzardLink();
    const rows = await blizzardRows(s.userId, s.guildId);
    await grant(s.guildId, s.memberId, T1);
    expect(await hasConfirmedMemberGrant(testApp.db, s.guildId, rows)).toBe(
      true,
    );
    expect(await linkedSince(s.guildId, s.charId)).toBeLessThan(T1.getTime());

    const wrote = await logExternalIdLinked(
      testApp.db,
      {
        actorId: null,
        ownerId: s.userId,
        characterId: s.charId,
        externalId: s.externalId,
        gameId: foreverId,
        region: 'us',
        via: 'auto_link',
      },
      null,
    );
    expect(wrote).toBe(true);
    await testApp.db
      .update(schema.activityLog)
      .set({ createdAt: T2 })
      .where(
        and(
          eq(schema.activityLog.action, 'external_id_linked'),
          sql`${schema.activityLog.metadata}->>'characterId' = ${s.charId}`,
        ),
      );

    expect(await hasConfirmedMemberGrant(testApp.db, s.guildId, rows)).toBe(
      false,
    );
    expect(await linkedSince(s.guildId, s.charId)).toBeGreaterThan(
      T1.getTime(),
    );

    await regrant(s.guildId, s.memberId, T3);
    expect(await hasConfirmedMemberGrant(testApp.db, s.guildId, rows)).toBe(
      true,
    );
  });
});

describe('ROK-2115 case 7b: admin Change owner of a Blizzard-only character', () => {
  it("re-audits the id link for the new owner, so the old owner's grant is not inherited", async () => {
    const s = await seedBlizzardLink();
    const newOwner = await insertUser();
    await grant(s.guildId, s.memberId, T1);
    const oldRows = await blizzardRows(s.userId, s.guildId);
    expect(await hasConfirmedMemberGrant(testApp.db, s.guildId, oldRows)).toBe(
      true,
    );

    const adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    const res = await testApp.request
      .put(`/admin/plugins/wow/characters/${s.charId}/owner`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: newOwner });
    expect(res.status).toBe(200);

    const newRows = await blizzardRows(newOwner, s.guildId);
    expect(newRows.map((r) => r.characterId)).toEqual([s.charId]);
    expect(await hasConfirmedMemberGrant(testApp.db, s.guildId, newRows)).toBe(
      false,
    );
    const audits = await idLinkAudits(newOwner);
    expect(audits.map((a) => [a.actorId, a.metadata])).toEqual([
      [
        testApp.seed.adminUser.id,
        expect.objectContaining({
          characterId: s.charId,
          externalId: s.externalId,
          ownerId: newOwner,
          via: 'admin_reassign',
        }),
      ],
    ]);
  });
});

describe('ROK-2115 case 8 (Ruling 1): holdsTopRank is GUID-only', () => {
  it('a Blizzard-only link to a rank-0 row is a member but never holds the top rank', async () => {
    const adapter = testApp.app.get(WowHubKindAdapter, { strict: false });
    const s = await seedBlizzardLink(0);
    const rows = await blizzardRows(s.userId, s.guildId);
    expect(rows.map((r) => r.rankIndex)).toEqual([0]);
    expect(await adapter.holdsTopRank(s.userId, s.guildId)).toBe(false);
  });

  it('control: a GUID link to a rank-0 row holds the top rank', async () => {
    const adapter = testApp.app.get(WowHubKindAdapter, { strict: false });
    const guildId = await insertGuild();
    const userId = await insertUser();
    const guid = `Player-2115G-${next()}`;
    await insertChar(userId, { addonGuid: guid });
    await insertRow(guildId, { guid, rankIndex: 0 });
    const rows = await findLinkedMemberRows(testApp.db, userId, guildId);
    expect(rows.map((r) => [r.via, r.rankIndex])).toEqual([['guid', 0]]);
    expect(await adapter.holdsTopRank(userId, guildId)).toBe(true);
  });
});
