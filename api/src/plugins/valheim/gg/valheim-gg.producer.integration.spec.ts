/**
 * ROK-2187 metric 11 — the Valheim GG card against a real database: deaths
 * across the Jan 1 boundary of the community tz (America/New_York, so the
 * year is [2026-01-01T05:00Z, 2027-01-01T05:00Z)), counted once each for
 * the user's claimed steam id, and skill gains from the year's play days.
 */
import { ValheimCharacterMessageSchema } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { fakeServer } from '../../pelican/testing/pelican-fixtures';
import { loadValheimFixture } from '../link/ingest/valheim-link-ingest.testing';
import type { GgCardContext } from '../../core/gg/gg-card.registry';
import { valheimYearProducer } from './valheim-gg.producer';

const STEAM = '76561190000000201';
const OTHER_STEAM = '76561190000000202';
let testApp: TestApp;
let n = 0;

const sk = (id: string, level: number) => ({ id, level, accumulator: 0 });

function ctxFor(userId: number): GgCardContext {
  return {
    db: testApp.db,
    userId,
    year: 2026,
    window: {
      start: new Date('2026-01-01T05:00:00Z'),
      end: new Date('2027-01-01T05:00:00Z'),
    },
    tz: 'America/New_York',
  };
}

async function insertServer(): Promise<number> {
  n += 1;
  const s = fakeServer(n);
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.pelicanServers)
      .values({
        panelUuid: s.uuid,
        identifier: s.identifier,
        name: s.name,
        gameId: testApp.seed.game.id,
      })
      .returning({ id: schema.pelicanServers.id }),
    'server',
  );
  return row.id;
}

async function insertProfile(
  serverId: number,
  steamId: string,
  claimedBy: number | null,
): Promise<number> {
  const ch = ValheimCharacterMessageSchema.parse(
    loadValheimFixture('character-vanilla'),
  );
  n += 1;
  const claim =
    claimedBy === null
      ? {}
      : { claimedBy, claimSource: 'manual' as const, claimedAt: new Date() };
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.valheimProfiles)
      .values({
        pelicanServerId: serverId,
        steamId,
        playerId: `${2000 + n}`,
        worldUid: '1234567890123',
        worldName: 'W',
        name: `Viking ${n}`,
        gameVersion: '0.220.5',
        modVersion: '1.0.0',
        capturedAt: new Date(),
        equipment: ch.equipment,
        inventory: ch.inventory,
        skills: ch.skills,
        trophies: [],
        knownItems: [],
        knownRecipes: [],
        ...claim,
      })
      .returning({ id: schema.valheimProfiles.id }),
    'profile',
  );
  return row.id;
}

async function insertDeath(
  serverId: number,
  steamId: string | null,
  at: string,
): Promise<void> {
  n += 1;
  await testApp.db.insert(schema.valheimPlayerDeaths).values({
    pelicanServerId: serverId,
    characterName: `Viking ${n}`,
    steamId,
    source: 'log',
    loggedAt: `log-${n}`,
    occurredAt: new Date(at),
  });
}

async function insertDay(
  profileId: number,
  playDate: string,
  start: number,
  end: number,
  skill = 'Swords',
): Promise<void> {
  const t = new Date(`${playDate}T12:00:00Z`);
  await testApp.db.insert(schema.valheimProfileSkillDays).values({
    profileId,
    playDate,
    firstSeenAt: t,
    lastSeenAt: t,
    startSkills: [sk(skill, start)],
    endSkills: [sk(skill, end)],
  });
}

async function insertOtherUser(): Promise<number> {
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: 'local:gg-other',
        username: 'gg-other',
        role: 'member',
      })
      .returning({ id: schema.users.id }),
    'other user',
  );
  return u.id;
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('valheimYearProducer (integration, ROK-2187)', () => {
  it('counts only the community-tz year’s deaths, once each, for the claimed steam id', async () => {
    const me = testApp.seed.adminUser.id;
    const server = await insertServer();
    await insertProfile(server, STEAM, me);
    await insertProfile(server, STEAM, me); // a second character: a death still counts once
    await insertProfile(server, OTHER_STEAM, await insertOtherUser());
    await insertDeath(server, STEAM, '2026-01-01T04:59:00Z'); // Dec 31 2025 local — out
    await insertDeath(server, STEAM, '2026-01-01T05:00:00Z'); // Jan 1 local — in
    await insertDeath(server, STEAM, '2026-07-04T20:00:00Z'); // in
    await insertDeath(server, STEAM, '2027-01-01T04:30:00Z'); // Dec 31 2026 local — in
    await insertDeath(server, STEAM, '2027-01-01T05:00:00Z'); // Jan 1 2027 local — out
    await insertDeath(server, OTHER_STEAM, '2026-05-05T12:00:00Z'); // someone else — out
    await insertDeath(server, null, '2026-05-05T12:00:00Z'); // unattributed — out
    const card = await valheimYearProducer(ctxFor(me));
    expect(card?.deaths).toBe(3);
  });

  it('sums each character’s last end − first start over the year’s play days only', async () => {
    const me = testApp.seed.adminUser.id;
    const server = await insertServer();
    const a = await insertProfile(server, STEAM, me);
    const b = await insertProfile(server, STEAM, me);
    await insertDay(a, '2025-12-31', 1, 5); // last year — out
    await insertDay(a, '2026-01-01', 5, 6);
    await insertDay(a, '2026-12-31', 6, 9);
    await insertDay(a, '2027-01-01', 9, 20); // next year — out
    await insertDay(b, '2026-04-04', 0, 2, 'Run');
    expect(await valheimYearProducer(ctxFor(me))).toEqual({
      characters: 2,
      deaths: 0,
      skillGains: [
        { skill: 'Swords', gained: 4 },
        { skill: 'Run', gained: 2 },
      ],
    });
  });

  it('omits the card for a user with no claimed Valheim activity in the year', async () => {
    const server = await insertServer();
    const other = await insertOtherUser();
    const p = await insertProfile(server, OTHER_STEAM, other);
    await insertDay(p, '2026-03-03', 1, 4);
    await insertDeath(server, OTHER_STEAM, '2026-03-03T12:00:00Z');
    expect(
      await valheimYearProducer(ctxFor(testApp.seed.adminUser.id)),
    ).toBeNull();
  });
});
