/**
 * ROK-1789 Part B — `GET /plugins/wow/guilds/:id/progression` against a real
 * database. AuthZ (B10): members + staff 200, outsider 403, no token 401,
 * unknown / non-guild hub 404, plugin inactive 403; a non-Forever
 * `wow_guild` still answers (Q-B15 is a web tab predicate). Progression:
 * map-id + boss-name grouping, the forever/classic total, the "Other
 * bosses" bucket, the Q1 trust filter. Activity: first-batch joins hidden,
 * roster import collapsed (Q-B14), grouped milestones (Q-B13), first kill
 * per (encounter, difficulty) (Q-B18), ended vs cancelled events, departed
 * members. The base data comes from the B9 demo seed (`withActivity`).
 * No afterAll truncate (shared pool).
 */
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  WowGuildProgressionPageSchema,
  type WowGuildActivityEntryDto,
  type WowGuildActivityEntryOf,
  type WowGuildActivityKind,
  type WowGuildProgressionPageDto,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../../common/testing/test-app';
import { loginAsAdmin } from '../../../../common/testing/integration-helpers';
import { signTestAccessToken } from '../../../../common/testing/sign-test-access-token';
import { nonEmpty } from '../../../../common/testing/narrow';
import { defined } from '../../../../common/defined.helpers';
import * as schema from '../../../../drizzle/schema';
import { SettingsService } from '../../../../settings/settings.service';
import type { SeedGuildResponse } from '../../../../admin/demo-test-guild.controller';
import { PluginRegistryService } from '../../../plugin-host/plugin-registry.service';
import { WOW_FOREVER_GAME_SLUG } from '../../wow-forever-identity.helpers';
import { addMonthsUtc } from './activity.helpers';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
const GUILD = 'Prog Keepers';
const DAY_MS = 86_400_000;
const MC_JOURNAL = 741;
const MC_BOSSES = [
  'Lucifron',
  'Magmadar',
  'Gehennas',
  'Garr',
  'Shazzrah',
  'Baron Geddon',
  'Sulfuron Harbinger',
  'Golemagg the Incinerator',
  'Majordomo Executus',
  'Ragnaros',
];

let testApp: TestApp;
let seeded: SeedGuildResponse;
let communityId: number;
let otherGameGuildId: number;
const tokens = new Map<string, string>();
const extra = { steady: 0, fresh: 0, gone: 0 };

const path = (id: number): string => `/plugins/wow/guilds/${id}/progression`;
const get = (who: string, id = seeded.guildId) =>
  testApp.request
    .get(path(id))
    .set('Authorization', `Bearer ${defined(tokens.get(who), who)}`);
const plugins = (): PluginRegistryService =>
  testApp.app.get(PluginRegistryService);

async function setDemoMode(on: boolean): Promise<void> {
  process.env.DEMO_MODE = on ? 'true' : 'false';
  await testApp.app.get(SettingsService).setDemoMode(on);
}

/** The suite's own WoW: Forever game row (the baseline seed has none). */
async function seedWowGame(): Promise<void> {
  const [existing] = await testApp.db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.slug, WOW_FOREVER_GAME_SLUG))
    .limit(1);
  if (existing) return;
  await testApp.db.insert(schema.games).values({
    name: 'World of Warcraft: Forever',
    slug: WOW_FOREVER_GAME_SLUG,
  });
}

/** The B9 seed: 50-row roster, import batch, milestones, events, pulls. */
async function seedShowcase(adminToken: string): Promise<SeedGuildResponse> {
  const res = await testApp.request
    .post('/admin/test/wow/seed-guild')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: GUILD, gameSlug: WOW_FOREVER_GAME_SLUG, withActivity: true });
  expect(res.status).toBe(200);
  return res.body as SeedGuildResponse;
}

/** Molten Core's 10 classic Journal rows (the suite truncates the table). */
async function seedMoltenCoreBosses(): Promise<void> {
  await testApp.db
    .insert(schema.wowClassicBosses)
    .values(
      MC_BOSSES.map((name, i) => ({
        instanceId: MC_JOURNAL,
        name,
        order: i + 1,
        expansion: 'classic',
      })),
    )
    .onConflictDoNothing();
}

/** One extra pull on the seeded guild (2 days ago). */
async function insertPull(
  encounterId: number,
  name: string,
  instanceId: number | null,
  reportedByUserId: number,
): Promise<void> {
  const startAt = new Date(Date.now() - 2 * DAY_MS);
  await testApp.db.insert(schema.addonEncounterPulls).values({
    gameId: seeded.gameId,
    region: 'us',
    encounterId,
    encounterName: name,
    difficultyId: 9,
    instanceId,
    groupSize: 40,
    startAt,
    endAt: new Date(startAt.getTime() + 180_000),
    success: true,
    roster: [],
    guildKey: GUILD.toLowerCase(),
    reportedByUserId,
    payloadSha256: createHash('sha256').update(`prog:${name}`).digest('hex'),
  });
}

/** One extra roster row on the seeded guild. */
async function insertMember(
  name: string,
  createdAt: Date,
  lastSeenAt: Date,
): Promise<number> {
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.guildMembers)
      .values({
        guildId: seeded.guildId,
        characterName: name,
        rankIndex: 4,
        rankName: 'Rank 4',
        source: 'addon_import',
        lastSeenAt,
        createdAt,
      })
      .returning({ id: schema.guildMembers.id }),
    name,
  );
  return row.id;
}

/** A bare hub (no roster) of `kind` on `gameId`. */
async function insertHub(
  name: string,
  kind: 'wow_guild' | 'game_community',
  gameId: number,
): Promise<number> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId,
        kind,
        region: 'us',
        name,
        nameKey: name.toLowerCase(),
        source: 'addon_import',
      })
      .returning({ id: schema.guilds.id }),
    name,
  );
  return g.id;
}

/** Edge-case rows the seed does not write. */
async function seedEdgeCases(): Promise<void> {
  const now = new Date();
  const gm = seeded.users.gm.userId;
  await insertPull(9001, 'Untrusted Boss', 409, seeded.users.outsider.userId);
  await insertPull(9002, 'Mystery Boss', null, gm);
  const steadyAt = new Date(addMonthsUtc(now, -1).getTime() - 2 * DAY_MS);
  extra.steady = await insertMember('Steadyone', steadyAt, now);
  const fiveDaysAgo = new Date(now.getTime() - 5 * DAY_MS);
  extra.fresh = await insertMember('Freshone', fiveDaysAgo, now);
  extra.gone = await insertMember('Goneone', fiveDaysAgo, new Date(0));
}

async function tokenFor(role: 'gm' | 'member' | 'outsider'): Promise<void> {
  const u = seeded.users[role];
  tokens.set(
    role,
    await signTestAccessToken(testApp, {
      sub: u.userId,
      username: u.username,
      role: 'member',
    }),
  );
}

beforeAll(async () => {
  testApp = await getTestApp();
  await plugins().ensureInstalled('blizzard');
  await plugins().activate('blizzard');
  await setDemoMode(true);
  await seedWowGame();
  const adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  tokens.set('admin', adminToken);
  seeded = await seedShowcase(adminToken);
  for (const role of ['gm', 'member', 'outsider'] as const)
    await tokenFor(role);
  await seedMoltenCoreBosses();
  await seedEdgeCases();
  communityId = await insertHub(
    'Prog Community',
    'game_community',
    seeded.gameId,
  );
  otherGameGuildId = await insertHub(
    'Prog Elsewhere',
    'wow_guild',
    testApp.seed.game.id,
  );
});

afterAll(() => {
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
});

/** GET as `who`, expect 200, contract-parse the body. */
async function page(
  who: string,
  id?: number,
): Promise<WowGuildProgressionPageDto> {
  const res = await get(who, id);
  expect(res.status).toBe(200);
  return WowGuildProgressionPageSchema.parse(res.body);
}

function ofKind<K extends WowGuildActivityKind>(
  entries: readonly WowGuildActivityEntryDto[],
  kind: K,
): WowGuildActivityEntryOf<K>[] {
  return entries.filter(
    (e): e is WowGuildActivityEntryOf<K> => e.kind === kind,
  );
}

describe('authZ (B10)', () => {
  it('a guild member and staff (not a member) read the page', async () => {
    expect((await page('member')).activity.windowDays).toBe(30);
    expect((await page('admin')).progression.pullCount).toBeGreaterThan(0);
  });

  it('an outsider → 403; no token → 401', async () => {
    const res = await get('outsider');
    expect(res.status).toBe(403);
    expect(String(res.body.message)).toContain('Not a member');
    expect((await testApp.request.get(path(seeded.guildId))).status).toBe(401);
  });

  it('staff on an unknown guild or a community hub → 404', async () => {
    expect((await get('admin', 999_999)).status).toBe(404);
    expect((await get('admin', communityId)).status).toBe(404);
  });

  it('a non-Forever wow_guild answers (Q-B15 is the web tab predicate)', async () => {
    const body = await page('admin', otherGameGuildId);
    expect(body.progression.instances).toEqual([]);
    expect(body.activity.entries).toEqual([]);
  });

  it('plugin inactive → 403 from the plugin guard', async () => {
    await plugins().deactivate('blizzard');
    try {
      const res = await get('member');
      expect(res.status).toBe(403);
      expect(String(res.body.message)).toContain('not active');
    } finally {
      await plugins().activate('blizzard');
    }
  });
});

describe('progression (B2/B3)', () => {
  it('groups map-409 pulls and the null-map Lucifron kill under Molten Core 10', async () => {
    const { instances } = (await page('member')).progression;
    const mc = defined(
      instances.find((i) => i.key === `j:${MC_JOURNAL}`),
      'Molten Core section',
    );
    expect(mc.name).toBe('Molten Core');
    expect(mc.bossTotal).toBe(10);
    const lucifron = mc.bosses.filter((b) => b.encounterId === 663);
    expect(lucifron.map((b) => b.difficultyId)).toContain(148);
    const elsewhere = instances.filter((i) => i.key !== `j:${MC_JOURNAL}`);
    expect(elsewhere.flatMap((i) => i.bosses.map((b) => b.name))).not.toContain(
      'Lucifron',
    );
  });

  it('an unknown boss lands in "Other bosses" (last, no total)', async () => {
    const { instances } = (await page('member')).progression;
    const other = defined(instances[instances.length - 1], 'last section');
    expect(other.key).toBe('other');
    expect(other.bossTotal).toBeNull();
    expect(other.bosses.map((b) => b.name)).toContain('Mystery Boss');
  });

  it('a pull reported by a non-roster user is excluded (Q1)', async () => {
    const body = await page('member');
    const names = body.progression.instances.flatMap((i) =>
      i.bosses.map((b) => b.name),
    );
    expect(names).not.toContain('Untrusted Boss');
    const kills = ofKind(body.activity.entries, 'first_kill').map(
      (e) => e.bossName,
    );
    expect(kills).not.toContain('Untrusted Boss');
  });
});

describe('activity feed (B5–B8)', () => {
  it('hides the founding batch, collapses the import, shows later joins', async () => {
    const activity = defined(seeded.activity, 'seed activity');
    const ids = (await page('member')).activity.entries.map((e) => e.id);
    expect(ids).not.toContain(`join:${seeded.users.gm.memberId}`);
    for (const id of activity.stamped.new_member)
      expect(ids).toContain(`join:${id}`);
    for (const id of activity.stamped.roster_import)
      expect(ids).not.toContain(`join:${id}`);
    expect(ids).toContain(`join:${extra.fresh}`);
    const imports = ofKind(
      (await page('member')).activity.entries,
      'roster_import',
    );
    expect(imports).toHaveLength(1);
    expect(imports[0]?.count).toBe(activity.stamped.roster_import.length);
  });

  it('a departed member (not in the latest snapshot) has no entries', async () => {
    const ids = (await page('member')).activity.entries.map((e) => e.id);
    expect(ids).not.toContain(`join:${extra.gone}`);
    expect(ids.filter((id) => id.startsWith(`ms:${extra.gone}:`))).toEqual([]);
  });

  it('single milestones per member; the same-day set is one grouped row', async () => {
    const activity = defined(seeded.activity, 'seed activity');
    const ms = ofKind((await page('member')).activity.entries, 'milestone');
    const steady = ms.find((e) => e.id === `ms:${extra.steady}:1`);
    expect(steady?.months).toBe(1);
    expect(steady?.count).toBe(1);
    for (const id of activity.stamped.milestone) {
      expect(ms.some((e) => e.id.startsWith(`ms:${id}:`))).toBe(true);
    }
    const grouped = ms.filter((e) => e.count > 1);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.count).toBe(activity.stamped.grouped_milestone.length);
  });

  it('one first kill per (encounter, difficulty)', async () => {
    const kills = ofKind((await page('member')).activity.entries, 'first_kill');
    expect(kills.length).toBeGreaterThan(0);
    expect(new Set(kills.map((k) => k.id)).size).toBe(kills.length);
    const mystery = kills.find((k) => k.bossName === 'Mystery Boss');
    expect(mystery?.instanceName).toBeNull();
  });

  it('ended guild events appear; the cancelled one does not', async () => {
    const { events } = defined(seeded.activity, 'seed activity');
    const ids = (await page('member')).activity.entries.map((e) => e.id);
    for (const id of events.ended) expect(ids).toContain(`event:${id}`);
    for (const id of events.cancelled) expect(ids).not.toContain(`event:${id}`);
  });
});
