/**
 * ROK-2158 — `GET /plugins/wow/guilds/:id` role chips against a real
 * database. The role counts include every roster member (one per linked
 * user + one per unclaimed member) and resolve each role as manual override
 * → Armory role (`guild_member_armory.role`) → character role; the Members
 * rows' `effectiveRole` uses the same resolution, so rows and chips agree.
 */
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { loginAsAdmin } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';

const SNAP = new Date('2026-11-01T20:00:00.000Z');

let testApp: TestApp;
let guildId = 0;
let adminToken = '';

async function insertGuild(): Promise<number> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: testApp.seed.game.id,
        region: 'us',
        name: 'Role Chip Keepers',
        nameKey: 'role chip keepers',
        source: 'addon_import',
        lastSnapshotAt: SNAP,
      })
      .returning(),
    'guild',
  );
  return g.id;
}

/** A latest-snapshot member with a verified Armory snapshot role. */
async function insertArmoryMember(
  name: string,
  blizzardCharacterId: number,
  role: string,
): Promise<number> {
  const [m] = nonEmpty(
    await testApp.db
      .insert(schema.guildMembers)
      .values({
        guildId,
        guid: `Player-1-${name}`,
        characterName: name,
        rankIndex: 2,
        rankName: 'Raider',
        source: 'addon_import',
        lastSeenAt: SNAP,
        blizzardCharacterId,
      })
      .returning(),
    'member',
  );
  await testApp.db.insert(schema.guildMemberArmory).values({
    guildMemberId: m.id,
    blizzardCharacterId,
    role,
    syncedAt: SNAP,
  });
  return m.id;
}

/** A linked character with NO manual role and no role of its own. */
async function linkRoleLessCharacter(name: string): Promise<string> {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${name}@role.test`, username: name })
      .returning(),
    'user',
  );
  const [char] = nonEmpty(
    await testApp.db
      .insert(schema.characters)
      .values({
        userId: user.id,
        gameId: testApp.seed.game.id,
        name,
        addonGuid: `Player-1-${name}`,
        role: null,
        roleOverride: null,
        isMain: true,
      })
      .returning(),
    'character',
  );
  return char.id;
}

beforeAll(async () => {
  testApp = await getTestApp();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  guildId = await insertGuild();
  // Unclaimed Holy Paladin: no RL character, Armory says healer.
  await insertArmoryMember('Bambolina', 7001, 'healer');
  // Linked character with no role of its own; its member's Armory says tank.
  await insertArmoryMember('Tankard', 7002, 'tank');
  await linkRoleLessCharacter('Tankard');
  // Unclaimed member with an invalid Armory role: no chip (unknown).
  await insertArmoryMember('Mystery', 7003, 'bard');
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

interface PageRow {
  name: string;
  characterId: string | null;
  effectiveRole: string | null;
}

describe('GET /:id — role counts include unclaimed members (ROK-2158)', () => {
  it('counts the unclaimed Armory healer and the linked Armory tank; rows agree', async () => {
    const res = await testApp.request
      .get(`/plugins/wow/guilds/${guildId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.roleCounts).toEqual({
      tank: 1,
      healer: 1,
      dps: 0,
      unknown: 1,
    });
    const rows = (res.body.ranks as { members: PageRow[] }[]).flatMap(
      (r) => r.members,
    );
    const byName = new Map(rows.map((r) => [r.name, r]));
    expect(byName.get('Bambolina')).toMatchObject({
      characterId: null,
      effectiveRole: 'healer',
    });
    expect(byName.get('Tankard')?.characterId).not.toBeNull();
    expect(byName.get('Tankard')?.effectiveRole).toBe('tank');
    expect(byName.get('Mystery')?.effectiveRole).toBeNull();
  });
});
