/**
 * ROK-2128 L3 — admin "Change owner" (`PUT /admin/plugins/wow/characters/:id/owner`)
 * and the ROK-1756 unlink widened to roster-claimed rows without a GUID,
 * against a real database: owner move + main demote/promote (D6), FLAG 10
 * future-signup detach, `character_claim` audits (D7), `system`
 * notifications to both players (FLAG 7), guards and conflicts.
 */
import * as bcrypt from 'bcrypt';
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../../common/testing/test-app';
import { nonEmpty } from '../../../../common/testing/narrow';
import * as schema from '../../../../drizzle/schema';
import { PluginRegistryService } from '../../../plugin-host/plugin-registry.service';

const FOREVER_SLUG = 'world-of-warcraft-forever';
const SNAPSHOT = new Date('2026-11-01T00:00:00Z');
const HOUR = 3_600_000;

let testApp: TestApp;
let foreverId: number;
let guildId: number;
let admin: { id: number; token: string };
const members = new Map<string, number>();

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

async function seedGuild(): Promise<void> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: foreverId,
        region: 'us',
        name: 'Owner Guild',
        nameKey: 'owner guild',
        source: 'addon_import',
        lastSnapshotAt: SNAPSHOT,
      })
      .returning({ id: schema.guilds.id }),
    'guild',
  );
  guildId = g.id;
  const rows: Array<{ characterName: string; guid?: string }> = [
    { characterName: 'Ashen Vale', guid: 'G-L3-ASHEN' },
    { characterName: 'Dup Name', guid: 'G-L3-DUP' },
    { characterName: 'Same Owner', guid: 'G-L3-SAME' },
    { characterName: 'Plain Row' },
  ];
  for (const seed of rows) {
    const [m] = nonEmpty(
      await testApp.db
        .insert(schema.guildMembers)
        .values({
          guildId,
          source: 'addon_import',
          lastSeenAt: SNAPSHOT,
          ...seed,
        })
        .returning({ id: schema.guildMembers.id }),
      'member',
    );
    members.set(seed.characterName, m.id);
  }
}

async function makeUser(
  handle: string,
  role: 'member' | 'admin' = 'member',
): Promise<{ id: number; token: string }> {
  const email = `${handle}@roster-claim-l3.test`;
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${email}`, username: handle, role })
      .returning(),
    'user',
  );
  await testApp.db.insert(schema.localCredentials).values({
    email,
    passwordHash: await bcrypt.hash('TestPassword123!', 4),
    userId: user.id,
  });
  const res = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });
  return { id: user.id, token: res.body.access_token as string };
}

/** Claim a seeded roster row through the real route; returns the character id. */
async function claimAs(token: string, name: string): Promise<string> {
  const id = members.get(name);
  if (id === undefined) throw new Error(`no seeded member ${name}`);
  const res = await testApp.request
    .post(`/plugins/wow/roster-claim/members/${id}/claim`)
    .set('Authorization', `Bearer ${token}`)
    .send({ ruleset: 'normal' });
  if (res.status !== 201) throw new Error(`claim ${name}: ${res.status}`);
  return res.body.id as string;
}

async function addCharacter(
  userId: number,
  name: string,
  isMain: boolean,
): Promise<string> {
  const [c] = nonEmpty(
    await testApp.db
      .insert(schema.characters)
      .values({ userId, gameId: foreverId, name, region: 'us', isMain })
      .returning({ id: schema.characters.id }),
    name,
  );
  return c.id;
}

/** An event starting `startH` hours from now with `userId` signed up on `characterId`. */
async function signupAt(
  userId: number,
  characterId: string,
  startH: number,
): Promise<number> {
  const start = new Date(Date.now() + startH * HOUR);
  const [e] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: `L3 ${startH}h`,
        creatorId: userId,
        duration: [start, new Date(start.getTime() + 3 * HOUR)],
      })
      .returning({ id: schema.events.id }),
    'event',
  );
  const [s] = nonEmpty(
    await testApp.db
      .insert(schema.eventSignups)
      .values({ eventId: e.id, userId, characterId })
      .returning({ id: schema.eventSignups.id }),
    'signup',
  );
  return s.id;
}

const reassign = (token: string, id: string, body: object) =>
  testApp.request
    .put(`/admin/plugins/wow/characters/${id}/owner`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

const unlink = (token: string, id: string) =>
  testApp.request
    .post(`/admin/plugins/wow/characters/${id}/unlink`)
    .set('Authorization', `Bearer ${token}`);

async function characterById(id: string) {
  return testApp.db
    .select()
    .from(schema.characters)
    .where(eq(schema.characters.id, id));
}

async function signupCharacter(signupId: number): Promise<string | null> {
  const [s] = nonEmpty(
    await testApp.db
      .select({ characterId: schema.eventSignups.characterId })
      .from(schema.eventSignups)
      .where(eq(schema.eventSignups.id, signupId)),
    'signup row',
  );
  return s.characterId;
}

async function claimAudits(action: string, ownerId: number) {
  return testApp.db
    .select()
    .from(schema.activityLog)
    .where(
      and(
        eq(schema.activityLog.entityType, 'character_claim'),
        eq(schema.activityLog.action, action),
        eq(schema.activityLog.entityId, ownerId),
      ),
    );
}

async function systemMessages(userId: number): Promise<string[]> {
  const rows = await testApp.db
    .select({ message: schema.notifications.message })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, userId),
        eq(schema.notifications.type, 'system'),
      ),
    );
  return rows.map((r) => r.message);
}

/** D7 audit row + FLAG 7 notices of a Change owner. */
async function expectReassignTrail(
  characterId: string,
  fromId: number,
  toId: number,
): Promise<void> {
  const [audit] = nonEmpty(
    await claimAudits('admin_reassigned', toId),
    'reassign audit',
  );
  expect(audit.actorId).toBe(admin.id);
  expect(audit.metadata).toMatchObject({
    characterId: characterId,
    guildId,
    memberId: members.get('Ashen Vale'),
    fromUserId: fromId,
    toUserId: toId,
    name: 'Ashen Vale',
  });
  // Review 1 MAJOR: a fresh GUID claim for the NEW owner, so a ROK-1794
  // member grant made for the old owner's link is not inherited.
  const guidClaims = await testApp.db
    .select()
    .from(schema.activityLog)
    .where(
      and(
        eq(schema.activityLog.entityType, 'addon_guid'),
        eq(schema.activityLog.action, 'addon_guid_claimed'),
        eq(schema.activityLog.entityId, toId),
      ),
    );
  expect(guidClaims.map((r) => [r.actorId, r.metadata])).toEqual([
    [
      admin.id,
      expect.objectContaining({
        characterId,
        guid: 'G-L3-ASHEN',
        via: 'admin_reassign',
      }),
    ],
  ]);
  expect(await systemMessages(fromId)).toContain(
    'An admin moved Ashen Vale to l3to.',
  );
  expect(await systemMessages(toId)).toContain('An admin gave you Ashen Vale.');
}

beforeAll(async () => {
  testApp = await getTestApp();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  foreverId = await ensureGame();
  await seedGuild();
  admin = await makeUser('l3boss', 'admin');
});

// No truncate here: the shared integration setup closes the pool in its own
// afterAll, and the next spec truncates in beforeAll.

describe('PUT /admin/plugins/wow/characters/:id/owner (ROK-2128 D6)', () => {
  it('moves the owner, demotes to alt, promotes the old alt, detaches future signups, audits, notifies both', async () => {
    const from = await makeUser('l3from');
    const to = await makeUser('l3to');
    const ashen = await claimAs(from.token, 'Ashen Vale'); // first → main
    const alt = await addCharacter(from.id, 'From Alt', false);
    await addCharacter(to.id, 'To Main', true);
    const future = await signupAt(from.id, ashen, 48);
    const past = await signupAt(from.id, ashen, -48);

    const res = await reassign(admin.token, ashen, { userId: to.id });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      characterId: ashen,
      fromUserId: from.id,
      toUserId: to.id,
    });
    const [moved] = nonEmpty(await characterById(ashen), 'moved');
    expect({ userId: moved.userId, isMain: moved.isMain }).toEqual({
      userId: to.id,
      isMain: false,
    });
    const [promoted] = nonEmpty(await characterById(alt), 'old alt');
    expect(promoted.isMain).toBe(true);
    expect(await signupCharacter(future)).toBeNull();
    expect(await signupCharacter(past)).toBe(ashen);
    await expectReassignTrail(ashen, from.id, to.id);
  });

  it('refuses a non-admin (403)', async () => {
    const owner = await makeUser('l3plain');
    const id = await addCharacter(owner.id, 'Plain Own', true);
    const res = await reassign(owner.token, id, { userId: admin.id });
    expect(res.status).toBe(403);
  });

  it('refuses a target who already has a character of that name (409)', async () => {
    const from = await makeUser('l3dupfrom');
    const to = await makeUser('l3dupto');
    const id = await claimAs(from.token, 'Dup Name');
    await addCharacter(to.id, 'Dup Name', false);
    const res = await reassign(admin.token, id, { userId: to.id });
    expect(res.status).toBe(409);
    const [row] = nonEmpty(await characterById(id), 'unmoved');
    expect(row.userId).toBe(from.id);
  });

  it('409 for the current owner, 404 for an unknown user, 400 for a bad body', async () => {
    const owner = await makeUser('l3same');
    const id = await claimAs(owner.token, 'Same Owner');
    expect((await reassign(admin.token, id, { userId: owner.id })).status).toBe(
      409,
    );
    expect((await reassign(admin.token, id, { userId: 999_999 })).status).toBe(
      404,
    );
    expect((await reassign(admin.token, id, { userId: 'x' })).status).toBe(400);
  });
});

describe('PUT …/owner — WoW characters only (ROK-2128 review 1)', () => {
  it('404s a character of a non-WoW game and leaves it with its owner', async () => {
    const owner = await makeUser('l3otherfrom');
    const to = await makeUser('l3otherto');
    const [game] = nonEmpty(
      await testApp.db
        .insert(schema.games)
        .values({ name: 'Not WoW L3', slug: 'rok-2128-not-wow' })
        .returning({ id: schema.games.id }),
      'non-wow game',
    );
    const [ch] = nonEmpty(
      await testApp.db
        .insert(schema.characters)
        .values({ userId: owner.id, gameId: game.id, name: 'Viking' })
        .returning({ id: schema.characters.id }),
      'non-wow character',
    );
    const res = await reassign(admin.token, ch.id, { userId: to.id });
    expect(res.status).toBe(404);
    const [row] = nonEmpty(await characterById(ch.id), 'unmoved');
    expect(row.userId).toBe(owner.id);
  });
});

describe('POST /admin/plugins/wow/characters/:id/unlink — roster rows (ROK-2128 FLAG 6)', () => {
  it('deletes a roster-claimed row without a GUID; it reappears; audited; owner notified', async () => {
    const owner = await makeUser('l3plainrow');
    const id = await claimAs(owner.token, 'Plain Row');

    const res = await unlink(admin.token, id);

    expect(res.status).toBe(200);
    expect(await characterById(id)).toEqual([]);
    const [audit] = nonEmpty(
      await claimAudits('admin_unlinked_roster', owner.id),
      'unlink audit',
    );
    expect(audit.metadata).toMatchObject({
      characterId: id,
      name: 'Plain Row',
    });
    expect(await systemMessages(owner.id)).toContain(
      'An admin removed Plain Row from your characters.',
    );
    const list = await testApp.request
      .get(`/plugins/wow/roster-claim/candidates?gameId=${foreverId}`)
      .set('Authorization', `Bearer ${owner.token}`);
    const names = (
      list.body.guilds as Array<{ candidates: Array<{ name: string }> }>
    ).flatMap((g) => g.candidates.map((c) => c.name));
    expect(names).toContain('Plain Row');
  });

  it('still refuses a manual character with no GUID (409)', async () => {
    const owner = await makeUser('l3manual');
    const id = await addCharacter(owner.id, 'Manual Only', true);
    expect((await unlink(admin.token, id)).status).toBe(409);
  });
});
