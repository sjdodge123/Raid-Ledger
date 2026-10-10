/**
 * ROK-1756 — LedgerLink import trust bounds against a real database:
 * (1) a forged future guild snapshot is rejected 422 and cannot lock the
 *     guild against honest imports;
 * (2) GUID squatting (operator option B): a GUID held by another user is
 *     neither created nor stolen, the first claim is audited, and an admin
 *     unlink frees it so the rightful owner can import; non-admins get 403.
 */
import * as bcrypt from 'bcrypt';
import { and, count, eq } from 'drizzle-orm';
import type { AddonWho } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { GUID_ALREADY_LINKED_MESSAGE } from './addon-import-binding.apply';
import { EXPORT_TIME_MESSAGE } from './addon-import.clock';
import { GUID_AUDIT_ENTITY } from './addon-import.guid-audit';
import {
  FIXTURE_GUID,
  buildCharPayload,
  buildGuildPayload,
  buildImportString,
  buildWho,
} from './testing/addon-fixture.builder';

const FOREVER_SLUG = 'world-of-warcraft-forever';
const HOUR_S = 3600;
let testApp: TestApp;

async function ensureGame(): Promise<void> {
  const [existing] = await testApp.db
    .select()
    .from(schema.games)
    .where(eq(schema.games.slug, FOREVER_SLUG))
    .limit(1);
  if (existing) return;
  await testApp.db
    .insert(schema.games)
    .values({ name: 'World of Warcraft: Forever', slug: FOREVER_SLUG });
}

async function user(username: string, role: 'member' | 'admin' = 'member') {
  const email = `${username}@test.local`;
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${email}`, username, role })
      .returning(),
    'user',
  );
  await testApp.db.insert(schema.localCredentials).values({
    email,
    passwordHash: await bcrypt.hash('TestPassword123!', 4),
    userId: row.id,
  });
  const login = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });
  return { userId: row.id, token: login.body.access_token as string };
}

const applyNew = (token: string, importString: string) =>
  testApp.request
    .post('/plugins/wow/characters/addon-import')
    .set('Authorization', `Bearer ${token}`)
    .send({ importString, dryRun: false });

const unlink = (token: string, id: string) =>
  testApp.request
    .post(`/admin/plugins/wow/characters/${id}/unlink`)
    .set('Authorization', `Bearer ${token}`);

const nowS = () => Math.floor(Date.now() / 1000);

const guildString = (snapshotAt: number, exportedAt = nowS()) => {
  const g = buildGuildPayload();
  return buildImportString({
    ...g,
    exportedAt,
    data: { ...g.data, snapshotAt },
  });
};

const charString = (who: Partial<AddonWho> = {}) =>
  buildImportString({
    ...buildCharPayload({ who: buildWho(who) }),
    exportedAt: nowS(),
  });

const characters = () => testApp.db.select().from(schema.characters);
const guildRows = () => testApp.db.select().from(schema.guilds);

const guidAudit = (action: string) =>
  testApp.db
    .select()
    .from(schema.activityLog)
    .where(
      and(
        eq(schema.activityLog.entityType, GUID_AUDIT_ENTITY),
        eq(schema.activityLog.action, action),
      ),
    );

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  await ensureGame();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('future snapshotAt cannot lock a guild (ROK-1756 finding 1)', () => {
  it('a snapshot dated a day ahead → 422, nothing stored, honest import still lands', async () => {
    const { token } = await user('forger');
    const forged = await applyNew(token, guildString(nowS() + 25 * HOUR_S));
    expect(forged.status).toBe(422);
    expect(forged.body).toMatchObject({
      code: 'INVALID_PAYLOAD',
      message: EXPORT_TIME_MESSAGE,
    });
    expect(await guildRows()).toHaveLength(0);

    const honestAt = nowS() - HOUR_S;
    const honest = await applyNew(token, guildString(honestAt));
    expect(honest.status).toBe(200);
    const [guild] = await guildRows();
    expect(guild?.lastSnapshotAt?.getTime()).toBe(honestAt * 1000);

    const later = await applyNew(token, guildString(honestAt + 60));
    expect(later.status).toBe(200);
    const [after] = await guildRows();
    expect(after?.lastSnapshotAt?.getTime()).toBe((honestAt + 60) * 1000);
  });

  it('the 2099 lock-out string is rejected outright', async () => {
    const { token } = await user('forger2099');
    const res = await applyNew(token, guildString(4_102_444_799));
    expect(res.status).toBe(422);
    expect(await guildRows()).toHaveLength(0);
  });
});

describe('GUID squatting — option B (ROK-1756 finding 2)', () => {
  it("another user's GUID is neither created nor stolen; the holder's import still works", async () => {
    const holder = await user('holder');
    const first = await applyNew(holder.token, charString());
    expect(first.status).toBe(200);
    const claimedId = first.body.target.characterId as string;

    const intruder = await user('intruder');
    for (const s of [charString(), charString({ fullName: 'Other-Realm' })]) {
      const res = await applyNew(intruder.token, s);
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({
        code: 'INVALID_PAYLOAD',
        message: GUID_ALREADY_LINKED_MESSAGE,
      });
    }
    const rows = await characters();
    expect(rows.map((r) => [r.id, r.userId, r.addonGuid])).toEqual([
      [claimedId, holder.userId, FIXTURE_GUID],
    ]);

    const again = await applyNew(holder.token, charString());
    expect(again.status).toBe(200);
    expect(again.body.target.characterId).toBe(claimedId);
  });

  it('the first claim of a GUID writes one audit line (who, GUID, character)', async () => {
    const holder = await user('auditee');
    const res = await applyNew(holder.token, charString());
    expect(res.status).toBe(200);
    await applyNew(holder.token, charString());
    const claims = await guidAudit('addon_guid_claimed');
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      entityId: holder.userId,
      actorId: holder.userId,
      metadata: expect.objectContaining({
        guid: FIXTURE_GUID,
        characterId: res.body.target.characterId,
      }),
    });
  });
});

describe('admin unlink — option B (ROK-1756 finding 2)', () => {
  it('admin unlink frees the GUID; the rightful owner then imports it', async () => {
    const squatter = await user('squatter');
    const squat = await applyNew(squatter.token, charString());
    const squatId = squat.body.target.characterId as string;
    const owner = await user('rightful');
    expect((await applyNew(owner.token, charString())).status).toBe(422);

    const admin = await user('boss', 'admin');
    const res = await unlink(admin.token, squatId);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      characterId: squatId,
      userId: squatter.userId,
      guid: FIXTURE_GUID,
    });
    const [unlinked] = await guidAudit('addon_guid_admin_unlinked');
    expect(unlinked).toMatchObject({
      actorId: admin.userId,
      entityId: squatter.userId,
    });

    const reclaim = await applyNew(owner.token, charString());
    expect(reclaim.status).toBe(200);
    const rows = await characters();
    expect(rows.map((r) => [r.userId, r.addonGuid])).toEqual([
      [owner.userId, FIXTURE_GUID],
    ]);
  });

  it('a non-admin unlink → 403 and the character stays', async () => {
    const holder = await user('keeper');
    const res = await applyNew(holder.token, charString());
    const id = res.body.target.characterId as string;
    const other = await user('meddler');
    expect((await unlink(other.token, id)).status).toBe(403);
    expect((await unlink(holder.token, id)).status).toBe(403);
    const [n] = await testApp.db.select({ n: count() }).from(schema.characters);
    expect(Number(n?.n)).toBe(1);
  });
});
