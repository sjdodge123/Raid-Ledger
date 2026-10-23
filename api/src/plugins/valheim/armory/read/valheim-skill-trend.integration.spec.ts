/**
 * ROK-1882 AC 7 — GET /plugins/valheim/armory/characters/:id carries
 * `skillTrend`: `days: []` with no history; the newest ≤3 play days, newest
 * first, with effective-level gains and |gain| < 0.05 dropped; a death
 * penalty passes through negative. A member and staff read the same trend
 * (visibility unchanged — the hidden-hub refusal runs before the trend read
 * and stays pinned by `valheim-armory-hidden-hub.integration.spec.ts`).
 * Also pins the DEMO seed option `skillDays: 3` the Playwright spec uses.
 */
import { eq } from 'drizzle-orm';
import {
  ValheimCharacterDetailSchema,
  type ValheimSkill,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../../../common/testing/integration-helpers';
import * as schema from '../../../../drizzle/schema';
import { SettingsService } from '../../../../settings/settings.service';
import { PluginRegistryService } from '../../../plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from '../../../pelican/pelican.constants';
import { memberToken } from '../../../pelican/testing/pelican-integration.helpers';
import { VALHEIM_GAME_SLUG, VALHEIM_PLUGIN_ID } from '../../valheim.constants';
import type { ArmoryCharacterFixture } from '../valheim-armory-demo-seed.controller';
import { DEMO_SKILL_DAY_PLAN } from '../valheim-armory-skill-days-demo.helpers';
import { playDateIn, resolvePlayTimezone } from '../valheim-skill-days.helpers';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
const ROUTE = '/admin/test/valheim/armory-character';
const DAY_MS = 24 * 60 * 60 * 1000;

let testApp: TestApp;
let adminToken: string;

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const registry = () => testApp.app.get(PluginRegistryService);
const sk = (id: string, level: number): ValheimSkill => ({
  id,
  level,
  accumulator: 0,
});

async function seed(body: object = {}): Promise<ArmoryCharacterFixture> {
  const res = await testApp.request
    .post(ROUTE)
    .set(bearer(adminToken))
    .send({ withCatalog: false, ...body });
  expect(res.status).toBe(200);
  return res.body as ArmoryCharacterFixture;
}

async function trendOf(id: number, token: string) {
  const res = await testApp.request
    .get(`/plugins/valheim/armory/characters/${id}`)
    .set(bearer(token));
  expect(res.status).toBe(200);
  return ValheimCharacterDetailSchema.parse(res.body).skillTrend;
}

/** The plan's play dates for a seed run at `at` on server `serverId`. */
async function planDates(serverId: number, at: number): Promise<string[]> {
  const S = schema.pelicanServers;
  const [row] = await testApp.db
    .select({ tz: S.timezone })
    .from(S)
    .where(eq(S.id, serverId));
  const tz = resolvePlayTimezone(row?.tz ?? null, null);
  return DEMO_SKILL_DAY_PLAN.map((p) =>
    playDateIn(new Date(at - p.daysAgo * DAY_MS), tz),
  );
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  testApp.app.get(SettingsService).invalidateCache(true);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  process.env.DEMO_MODE = 'true';
  await testApp.app.get(SettingsService).setDemoMode(true);
  await testApp.db
    .insert(schema.games)
    .values({ name: 'Valheim', slug: VALHEIM_GAME_SLUG });
});

afterEach(async () => {
  for (const slug of [VALHEIM_PLUGIN_ID, PELICAN_PLUGIN_ID]) {
    if (registry().isActive(slug)) await registry().deactivate(slug);
  }
});

afterAll(() => {
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
});

describe('character detail skillTrend (ROK-1882 AC 7)', () => {
  it('sends days: [] when the character has no play-day history', async () => {
    const { characterId } = await seed();
    const member = await memberToken(testApp, 'bob');
    expect(await trendOf(characterId, member)).toEqual({ days: [] });
  });
});

describe('DEMO seed skillDays (ROK-1882)', () => {
  it('skillDays: 3 seeds Swords +2.0/+1.6/+0.5 newest first, Run idle on the newest day', async () => {
    const before = Date.now();
    const { characterId, serverId } = await seed({ skillDays: 3 });
    const after = Date.now();
    const member = await memberToken(testApp, 'bob');
    const trend = await trendOf(characterId, member);
    const dates = trend?.days.map((d) => d.date);
    expect([
      await planDates(serverId, before),
      await planDates(serverId, after),
    ]).toContainEqual(dates);
    const gains = trend?.days.map((d) => d.gains) ?? [];
    expect(gains.map((g) => Object.keys(g).sort())).toEqual([
      ['Swords'],
      ['Run', 'Swords'],
      ['Run', 'Swords'],
    ]);
    expect(gains.map((g) => g.Swords)).toEqual([
      expect.closeTo(2.0, 9),
      expect.closeTo(1.6, 9),
      expect.closeTo(0.5, 9),
    ]);
    expect(gains[1]?.Run).toBeCloseTo(1.0, 9);
    expect(gains[2]?.Run).toBeCloseTo(0.5, 9);
  });
});

describe('character detail skillTrend — stored rows (ROK-1882 AC 7)', () => {
  it('keeps the newest 3 of 4 days, drops |gain| < 0.05, passes a death penalty through; staff = member', async () => {
    const { characterId: profileId } = await seed();
    const at = new Date('2026-10-20T20:00:00Z');
    const row = (
      playDate: string,
      start: ValheimSkill[],
      end: ValheimSkill[],
    ) => ({
      profileId,
      playDate,
      firstSeenAt: at,
      lastSeenAt: at,
      startSkills: start,
      endSkills: end,
    });
    await testApp.db
      .insert(schema.valheimProfileSkillDays)
      .values([
        row('2026-10-01', [sk('Run', 1)], [sk('Run', 9)]),
        row(
          '2026-10-20',
          [sk('Swords', 30), sk('Run', 41)],
          [sk('Swords', 28.8), sk('Run', 41.04)],
        ),
        row('2026-10-15', [sk('Bows', 5)], [sk('Bows', 5.5), sk('Axes', 1)]),
        row('2026-10-18', [sk('Run', 40)], [sk('Run', 40.01)]),
      ]);
    const member = await memberToken(testApp, 'bob');
    const trend = await trendOf(profileId, member);
    expect(trend?.days.map((d) => d.date)).toEqual([
      '2026-10-20',
      '2026-10-18',
      '2026-10-15',
    ]);
    expect(Object.keys(trend?.days[0]?.gains ?? {})).toEqual(['Swords']);
    expect(trend?.days[0]?.gains.Swords).toBeCloseTo(-1.2, 9);
    expect(trend?.days[1]?.gains).toEqual({});
    expect(trend?.days[2]?.gains.Axes).toBe(1);
    expect(trend?.days[2]?.gains.Bows).toBeCloseTo(0.5, 9);
    expect(await trendOf(profileId, adminToken)).toEqual(trend);
  });
});

describe('DEMO seed skillDays validation (ROK-1882)', () => {
  it('400s an unsupported skillDays count', async () => {
    const res = await testApp.request
      .post(ROUTE)
      .set(bearer(adminToken))
      .send({ skillDays: 2 });
    expect(res.status).toBe(400);
  });
});
