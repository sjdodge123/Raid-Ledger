/**
 * ROK-2137 (guild text sync P1) — a LedgerLink guild export carrying the
 * in-game MOTD / Guild Information stores it as the REPORTED text on
 * `guild_profiles.game_*` with the snapshot's instant. Absent = no opinion
 * (stored value kept), an older snapshot never overwrites a newer report,
 * and the hub's own text (`ingame_*`, ROK-2136) is never touched.
 * Harness copied from `addon-import-guild-rename.integration.spec.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import type { AddonGuildMember } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import {
  FIXTURE_EXPORTED_AT,
  buildGuildPayload,
  buildImportString,
} from './testing/addon-fixture.builder';
import { pinExportClock } from './testing/pin-export-clock';

pinExportClock();

const FOREVER_SLUG = 'world-of-warcraft-forever';
const FIXTURES = join(
  __dirname,
  '../../../../../packages/contract/ledgerlink/v1/fixtures',
);
const fixture = (name: string): string =>
  readFileSync(join(FIXTURES, `${name}.txt`), 'utf8');
const fixtureJson = <T>(name: string): T =>
  JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as T;

interface GuildFixture {
  payload: {
    data: { members: AddonGuildMember[]; motd: string; infoText: string };
  };
}
const golden = () => fixtureJson<GuildFixture>('guild-ingame-text').payload;

let testApp: TestApp;
let gameId: number;

async function ensureGame(slug: string, name: string): Promise<number> {
  const [existing] = await testApp.db
    .select()
    .from(schema.games)
    .where(eq(schema.games.slug, slug))
    .limit(1);
  if (existing) return existing.id;
  const [game] = nonEmpty(
    await testApp.db.insert(schema.games).values({ name, slug }).returning(),
    `${slug} game`,
  );
  return game.id;
}

async function memberToken(username: string): Promise<string> {
  const email = `${username}@test.local`;
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${email}`, username, role: 'member' })
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
  return res.body.access_token as string;
}

async function createChar(token: string): Promise<string> {
  const res = await testApp.request
    .post('/users/me/characters')
    .set('Authorization', `Bearer ${token}`)
    .send({
      gameId,
      name: 'Ana Forever',
      class: 'Paladin',
      region: 'us',
      ruleset: 'normal',
    });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

/** Apply a single-section `importString`; HTTP status + import status. */
async function apply(importString: string): Promise<[number, unknown]> {
  const res = await testApp.request
    .post(`/plugins/wow/characters/${charId}/addon-import`)
    .set('Authorization', `Bearer ${token}`)
    .send({ importString, dryRun: false });
  return [res.status, (res.body as { status?: unknown }).status];
}

type TextFields = { motd?: string; infoText?: string };

/** The golden roster `step` minutes after the golden export, with `text`. */
function snapshot(step: number, text: TextFields): string {
  const payload = buildGuildPayload(golden().data.members);
  payload.data.snapshotAt += step * 60;
  payload.data = { ...payload.data, ...text };
  return buildImportString(payload);
}

/** The single guild's profile row (game_* + the hub's ingame_* columns). */
async function profile() {
  const [row] = await testApp.db.select().from(schema.guildProfiles);
  return row;
}

const at = (step: number): Date =>
  new Date((FIXTURE_EXPORTED_AT + step * 60) * 1000);

let token: string;
let charId: string;

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  gameId = await ensureGame(FOREVER_SLUG, 'World of Warcraft: Forever');
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  token = await memberToken('motdreporter');
  charId = await createChar(token);
});

afterEach(async () => {
  process.env.THROTTLE_DISABLED = 'true';
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('ROK-2137 — LedgerLink reports the in-game MOTD / Guild Info', () => {
  it('the golden fixture stores both texts with the snapshot instant', async () => {
    expect(await apply(fixture('guild-ingame-text'))).toEqual([200, 'applied']);
    const row = await profile();
    expect({
      motd: row?.gameMotd,
      motdAt: row?.gameMotdReportedAt?.toISOString(),
      info: row?.gameInfo,
      infoAt: row?.gameInfoReportedAt?.toISOString(),
      hubMotd: row?.ingameMotd,
      hubInfo: row?.ingameInfo,
    }).toEqual({
      motd: golden().data.motd,
      motdAt: at(0).toISOString(),
      info: golden().data.infoText,
      infoAt: at(0).toISOString(),
      hubMotd: null,
      hubInfo: null,
    });
  });

  it('an export without the keys reports nothing', async () => {
    expect(await apply(fixture('guild-1-page'))).toEqual([200, 'applied']);
    const row = await profile();
    expect([
      row?.gameMotdReportedAt ?? null,
      row?.gameInfoReportedAt ?? null,
    ]).toEqual([null, null]);
  });

  it('an absent key keeps the stored text; a present one updates it', async () => {
    await apply(snapshot(0, { motd: 'Old MOTD', infoText: 'Old info' }));
    expect(await apply(snapshot(5, { infoText: 'New info' }))).toEqual([
      200,
      'applied',
    ]);
    const row = await profile();
    expect([row?.gameMotd, row?.gameMotdReportedAt?.toISOString()]).toEqual([
      'Old MOTD',
      at(0).toISOString(),
    ]);
    expect([row?.gameInfo, row?.gameInfoReportedAt?.toISOString()]).toEqual([
      'New info',
      at(5).toISOString(),
    ]);
  });

  it('an empty in-game box is a report: NULL text, timestamp moves', async () => {
    await apply(snapshot(0, { motd: 'Old MOTD' }));
    await apply(snapshot(5, { motd: '' }));
    const row = await profile();
    expect([row?.gameMotd, row?.gameMotdReportedAt?.toISOString()]).toEqual([
      null,
      at(5).toISOString(),
    ]);
  });
});

describe('ROK-2137 — reported text guards', () => {
  it('an older snapshot never overwrites a newer report', async () => {
    await apply(snapshot(10, { motd: 'Newer MOTD', infoText: 'Newer info' }));
    const [, status] = await apply(
      snapshot(5, { motd: 'Older MOTD', infoText: 'Older info' }),
    );
    expect(status).toBe('stale');
    const row = await profile();
    expect([row?.gameMotd, row?.gameInfo]).toEqual([
      'Newer MOTD',
      'Newer info',
    ]);
    expect(row?.gameMotdReportedAt?.toISOString()).toBe(at(10).toISOString());
  });

  it('never touches the hub text; a Push ack survives the same text, a changed text clears it (review r2)', async () => {
    await apply(snapshot(0, { motd: 'First' }));
    const ack = new Date('2026-01-01T00:00:00Z');
    await testApp.db.update(schema.guildProfiles).set({
      ingameMotd: 'Hub MOTD',
      gameMotdAcknowledgedAt: ack,
    });
    await apply(snapshot(5, { motd: 'First' }));
    const kept = await profile();
    expect([
      kept?.ingameMotd,
      kept?.gameMotdAcknowledgedAt?.toISOString(),
    ]).toEqual(['Hub MOTD', ack.toISOString()]);
    await apply(snapshot(10, { motd: 'Second' }));
    const row = await profile();
    expect([
      row?.ingameMotd,
      row?.gameMotd,
      row?.gameMotdAcknowledgedAt ?? null,
    ]).toEqual(['Hub MOTD', 'Second', null]);
  });

  it('stores the text normalised like the hub (CRLF → LF, trailing space)', async () => {
    await apply(snapshot(0, { infoText: 'Line 1  \r\nLine 2\r\n' }));
    expect((await profile())?.gameInfo).toBe('Line 1\nLine 2');
  });
});
