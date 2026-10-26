/**
 * ROK-1950 A2 — `PATCH /guilds/:id/name` against a real database (spec §4
 * cases 1–16). Fleet-only. Community hubs are built with the core insert
 * helper; server hubs through the Pelican admin PATCH (as in A1's
 * `server-hub-rename-sync.integration.spec.ts`); the WoW row directly.
 *
 * Mutations (for the Lead): drop the service leader re-check AND the route
 * guard → the officer case goes red; drop `hasNameClash` → "taken name" stays
 * 409 via `conflictOnUnique`; drop that too → 409 expected, 500 received;
 * drop the `sourceName` call → the reset case goes red (409 instead of 200);
 * move the audit out of the rename transaction → case 17 goes red (the name
 * reads 'Atomic New', not 'Atomic Old').
 */
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import { signTestAccessToken } from '../common/testing/sign-test-access-token';
import * as schema from '../drizzle/schema';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from '../plugins/pelican/pelican.constants';
import { fakeServer } from '../plugins/pelican/testing/pelican-fixtures';
import { SettingsService } from '../settings/settings.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { insertCommunityHub } from './community/community-proposals.queries';
import { RENAME_ERRORS } from './hub-rename.helpers';

type Role = 'member' | 'operator';
type HubRole = 'leader' | 'officer' | 'member';
interface Who {
  id: number;
  token: string;
}

let testApp: TestApp;
let admin: Who;
let seq = 0;
const next = (p: string): string => `${p}-${++seq}-${Date.now() % 100000}`;
const registry = () => testApp.app.get(PluginRegistryService);

async function mkUser(role: Role = 'member'): Promise<Who> {
  const username = next('rn');
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ username, role, guildMemberSeenAt: new Date() })
      .returning(),
    'user',
  );
  const token = await signTestAccessToken(testApp, { sub: user.id, username });
  return { id: user.id, token };
}

const rename = (id: number, who: Who, body: object) =>
  testApp.request
    .patch(`/guilds/${id}/name`)
    .set('Authorization', `Bearer ${who.token}`)
    .send(body);

const patchServer = (id: number, body: object) =>
  testApp.request
    .patch(`/admin/plugins/pelican/servers/${id}`)
    .set('Authorization', `Bearer ${admin.token}`)
    .send(body);

/** A community hub; `members` get the given hub roles. */
async function mkCommunity(
  name: string,
  members: [Who, HubRole][] = [],
  status: 'active' | 'archived' | 'proposed' = 'active',
): Promise<number> {
  const hub = await insertCommunityHub(testApp.db, {
    gameId: testApp.seed.game.id,
    name,
    blurb: 'Rename hub',
    status: status === 'proposed' ? 'proposed' : 'active',
    proposedBy: admin.id,
    reviewedBy: status === 'proposed' ? null : admin.id,
  });
  if (status === 'archived') {
    await testApp.db
      .update(schema.guilds)
      .set({ status: 'archived' })
      .where(eq(schema.guilds.id, hub.id));
  }
  if (members.length > 0) {
    await testApp.db
      .insert(schema.hubCommunityMembers)
      .values(
        members.map(([w, role]) => ({ guildId: hub.id, userId: w.id, role })),
      );
  }
  return hub.id;
}

/** A mapped Pelican server with its hub on; returns both ids. */
async function mkServerHub(
  name = 'Valheim Main',
): Promise<{ serverId: number; guildId: number }> {
  const s = fakeServer(++seq);
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.pelicanServers)
      .values({
        panelUuid: s.uuid,
        identifier: s.identifier,
        name,
        gameId: testApp.seed.game.id,
        currentState: 'running',
        statusCheckedAt: new Date(),
        lastSyncedAt: new Date(),
      })
      .returning({ id: schema.pelicanServers.id }),
    'server',
  );
  expect((await patchServer(row.id, { communityHub: true })).status).toBe(200);
  const [hub] = nonEmpty(
    await testApp.db
      .select({ id: schema.guilds.id })
      .from(schema.guilds)
      .where(eq(schema.guilds.pelicanServerId, row.id)),
    'server hub',
  );
  return { serverId: row.id, guildId: hub.id };
}

async function mkWowGuild(): Promise<number> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: testApp.seed.game.id,
        region: 'us',
        name: 'Rename Wow Guild',
        nameKey: 'rename wow guild',
        source: 'addon_import',
      })
      .returning({ id: schema.guilds.id }),
    'wow guild',
  );
  return g.id;
}

async function hubRow(id: number): Promise<schema.GuildSelect> {
  const [row] = nonEmpty(
    await testApp.db
      .select()
      .from(schema.guilds)
      .where(eq(schema.guilds.id, id)),
    'hub',
  );
  return row;
}

async function auditRows(id: number) {
  const a = schema.activityLog;
  return testApp.db
    .select({ actorId: a.actorId, metadata: a.metadata })
    .from(a)
    .where(
      and(
        eq(a.entityType, 'hub'),
        eq(a.entityId, id),
        eq(a.action, 'hub_renamed'),
      ),
    );
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  await registry().ensureInstalled(PELICAN_PLUGIN_ID);
  await registry().activate(PELICAN_PLUGIN_ID);
  const token = await loginAsAdmin(testApp.request, testApp.seed);
  admin = { id: testApp.seed.adminUser.id, token };
});

afterEach(async () => {
  if (registry().isActive(PELICAN_PLUGIN_ID))
    await registry().deactivate(PELICAN_PLUGIN_ID);
  if (registry().isActive('blizzard')) await registry().deactivate('blizzard');
  testApp.seed = await truncateAllTables(testApp.db);
  testApp.app.get(SettingsService).invalidateCache(true);
});

describe('PATCH /guilds/:id/name — community hubs', () => {
  it('1: an admin renames; name + name_key set; audited', async () => {
    const id = await mkCommunity('Rename Old');
    const res = await rename(id, admin, { name: 'Rename New' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, name: 'Rename New' });
    expect(res.body).not.toHaveProperty('nameOverridden');
    expect(await hubRow(id)).toMatchObject({
      name: 'Rename New',
      nameKey: 'rename new',
      nameOverridden: false,
    });
    expect(await auditRows(id)).toEqual([
      {
        actorId: admin.id,
        metadata: {
          from: 'Rename Old',
          to: 'Rename New',
          kind: 'game_community',
          reset: false,
        },
      },
    ]);
  });

  it('2: an operator and the hub leader can rename', async () => {
    const op = await mkUser('operator');
    const leader = await mkUser();
    const id = await mkCommunity('Rename Two', [[leader, 'leader']]);
    expect((await rename(id, op, { name: 'By Operator' })).status).toBe(200);
    expect((await rename(id, leader, { name: 'By Leader' })).status).toBe(200);
    expect((await hubRow(id)).name).toBe('By Leader');
  });

  it('3: an officer gets 403 but can still edit the blurb', async () => {
    const officer = await mkUser();
    const id = await mkCommunity('Rename Three', [[officer, 'officer']]);
    const res = await rename(id, officer, { name: 'Officer Name' });
    expect(res.status).toBe(403);
    expect((await hubRow(id)).name).toBe('Rename Three');
    const blurb = await testApp.request
      .patch(`/hubs/${id}`)
      .set('Authorization', `Bearer ${officer.token}`)
      .send({ blurb: 'Officer blurb' });
    expect(blurb.status).toBe(200);
  });

  it('4: a member and a non-member visitor get 403', async () => {
    const member = await mkUser();
    const visitor = await mkUser();
    const id = await mkCommunity('Rename Four', [[member, 'member']]);
    expect((await rename(id, member, { name: 'Member Name' })).status).toBe(
      403,
    );
    expect((await rename(id, visitor, { name: 'Visitor Name' })).status).toBe(
      403,
    );
    expect(await auditRows(id)).toHaveLength(0);
  });

  it.each([
    ['too short', { name: '  ab ' }],
    ['65 characters', { name: 'x'.repeat(65) }],
    ['no letter or digit', { name: '!!!' }],
    ['a control character', { name: 'Bad\u0007Name' }],
    ['missing name', {}],
    ['an extra key', { name: 'Fine Name', extra: 1 }],
    ['a reset on a community hub', { name: null }],
  ])('5: 400 for %s', async (_label, body) => {
    const id = await mkCommunity(next('Rename Five'));
    expect((await rename(id, admin, body)).status).toBe(400);
  });

  it('6: a clash is 409; archived names, case-only and same-name edits pass', async () => {
    const id = await mkCommunity('Rename Six');
    await mkCommunity('Taken Name');
    await mkCommunity('Old Archived', [], 'archived');
    const taken = await rename(id, admin, { name: 'taken name' });
    expect(taken.status).toBe(409);
    expect(taken.body).toMatchObject({ message: RENAME_ERRORS.nameTaken });
    expect((await rename(id, admin, { name: 'Old Archived' })).status).toBe(
      200,
    );
    expect((await rename(id, admin, { name: 'OLD ARCHIVED' })).status).toBe(
      200,
    );
    expect((await rename(id, admin, { name: 'OLD ARCHIVED' })).status).toBe(
      200,
    );
    const audits = await auditRows(id);
    expect(audits.map((a) => a.metadata)).toEqual([
      {
        from: 'Rename Six',
        to: 'Old Archived',
        kind: 'game_community',
        reset: false,
      },
      {
        from: 'Old Archived',
        to: 'OLD ARCHIVED',
        kind: 'game_community',
        reset: false,
      },
    ]);
  });

  it.each(['archived', 'proposed'] as const)(
    '7: a %s community hub is 404',
    async (status) => {
      const id = await mkCommunity(next('Rename Seven'), [], status);
      expect((await rename(id, admin, { name: 'Any Name' })).status).toBe(404);
    },
  );
});

describe('PATCH /guilds/:id/name — server hubs', () => {
  it('8+9: a rename sets the override and survives the Pelican sync', async () => {
    const { serverId, guildId } = await mkServerHub();
    const res = await rename(guildId, admin, { name: 'Our Viking Home' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Our Viking Home',
      nameOverridden: true,
    });
    expect(await hubRow(guildId)).toMatchObject({
      nameKey: 'our viking home',
      nameOverridden: true,
    });
    expect((await auditRows(guildId)).map((a) => a.metadata)).toEqual([
      {
        from: 'Valheim Main',
        to: 'Our Viking Home',
        kind: 'game_server',
        reset: false,
      },
    ]);
    expect(
      (await patchServer(serverId, { showOnCalendar: false })).status,
    ).toBe(200);
    const page = await testApp.request
      .get(`/guilds/${guildId}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({ guild: { name: 'Our Viking Home' } });
  });

  it('10: a reset goes back to the server name, which the sync then follows', async () => {
    const { serverId, guildId } = await mkServerHub();
    await rename(guildId, admin, { name: 'Our Viking Home' }).expect(200);
    const res = await rename(guildId, admin, { name: null });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Valheim Main',
      nameOverridden: false,
    });
    expect((await auditRows(guildId)).map((a) => a.metadata)).toContainEqual({
      from: 'Our Viking Home',
      to: 'Valheim Main',
      kind: 'game_server',
      reset: true,
    });
    await testApp.db
      .update(schema.pelicanServers)
      .set({ name: 'Valheim Renamed' })
      .where(eq(schema.pelicanServers.id, serverId));
    await patchServer(serverId, { showOnCalendar: false }).expect(200);
    expect((await hubRow(guildId)).name).toBe('Valheim Renamed');
  });

  it('11: renaming to exactly the server name clears the override', async () => {
    const { guildId } = await mkServerHub();
    await rename(guildId, admin, { name: 'Custom' }).expect(200);
    await rename(guildId, admin, { name: 'Valheim Main' }).expect(200);
    expect(await hubRow(guildId)).toMatchObject({
      name: 'Valheim Main',
      nameOverridden: false,
    });
  });

  it('12: with the server gone a reset is 409, a name still 200', async () => {
    const { guildId } = await mkServerHub();
    await testApp.db
      .update(schema.guilds)
      .set({ pelicanServerId: null })
      .where(eq(schema.guilds.id, guildId));
    const reset = await rename(guildId, admin, { name: null });
    expect(reset.status).toBe(409);
    expect(reset.body).toMatchObject({ message: RENAME_ERRORS.serverGone });
    expect((await rename(guildId, admin, { name: 'Orphan Name' })).status).toBe(
      200,
    );
  });

  it('13: a non-staff user is 403; a hidden hub renamed by an admin is 200', async () => {
    const { guildId } = await mkServerHub();
    const user = await mkUser();
    expect((await rename(guildId, user, { name: 'Nope Name' })).status).toBe(
      403,
    );
    await testApp.db
      .update(schema.guilds)
      .set({ hiddenAt: new Date() })
      .where(eq(schema.guilds.id, guildId));
    expect((await rename(guildId, admin, { name: 'Hidden Name' })).status).toBe(
      200,
    );
  });

  it('14: two server hubs of one game may share a name', async () => {
    const a = await mkServerHub('Server A');
    const b = await mkServerHub('Server B');
    await rename(a.guildId, admin, { name: 'Shared Name' }).expect(200);
    await rename(b.guildId, admin, { name: 'Shared Name' }).expect(200);
  });
});

describe('PATCH /guilds/:id/name — WoW and unknown ids', () => {
  it('15: an admin renames a WoW guild; name_key stays the import key (ROK-2015 D1)', async () => {
    await registry().ensureInstalled('blizzard');
    await registry().activate('blizzard');
    const id = await mkWowGuild();
    await rename(id, admin, { name: 'New Wow Name' }).expect(200);
    expect(await hubRow(id)).toMatchObject({
      name: 'New Wow Name',
      nameKey: 'rename wow guild',
      nameOverridden: true,
    });
  });

  it('16: an unknown id is 404 for an admin', async () => {
    expect((await rename(999999, admin, { name: 'Ghost Name' })).status).toBe(
      404,
    );
  });
});

describe('PATCH /guilds/:id/name — atomic audit (ROK-1950 review)', () => {
  it('17: a failing audit insert rolls the rename back; a retry renames + audits', async () => {
    const id = await mkCommunity('Atomic Old');
    const spy = jest
      .spyOn(testApp.app.get(ActivityLogService), 'log')
      .mockRejectedValueOnce(new Error('audit insert failed'));
    try {
      expect((await rename(id, admin, { name: 'Atomic New' })).status).toBe(
        500,
      );
      expect(await hubRow(id)).toMatchObject({
        name: 'Atomic Old',
        nameKey: 'atomic old',
      });
      expect(await auditRows(id)).toEqual([]);
    } finally {
      spy.mockRestore();
    }
    await rename(id, admin, { name: 'Atomic New' }).expect(200);
    expect((await hubRow(id)).name).toBe('Atomic New');
    expect(await auditRows(id)).toHaveLength(1);
  });
});
