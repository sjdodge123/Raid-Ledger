/**
 * ROK-1941 L1 (AC4): a death post and a console death count ONCE, in
 * either order, replay-safe and race-safe — SQL A (`linkOrInferDeath`) and
 * SQL B (`recordLogDeath`) against a real database under the D9 lock.
 */
import { asc, eq, inArray } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { fakeServer } from '../../pelican/testing/pelican-fixtures';
import {
  ValheimDeathsRepository,
  type LogDeathInput,
} from '../armory/valheim-deaths.repository';
import {
  ValheimDeathLinkRepository,
  type DeathPostInput,
} from './valheim-death-link.repository';

const T = new Date('2026-10-20T12:00:00.000Z');
const W = 120;
let testApp: TestApp;
let serverId: number;
let guildId: number;
let mediaSeq = 0;

const links = () => new ValheimDeathLinkRepository(testApp.db);
const logs = () => new ValheimDeathsRepository(testApp.db);
const at = (offsetSec: number) => new Date(T.getTime() + offsetSec * 1000);
const rows = () =>
  testApp.db
    .select()
    .from(schema.valheimPlayerDeaths)
    .where(eq(schema.valheimPlayerDeaths.pelicanServerId, serverId))
    .orderBy(asc(schema.valheimPlayerDeaths.id));

async function seedServerAndHub(): Promise<void> {
  const [game] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'Valheim L1', slug: 'valheim-l1' })
      .returning({ id: schema.games.id }),
    'game',
  );
  const s = fakeServer(41);
  const [server] = nonEmpty(
    await testApp.db
      .insert(schema.pelicanServers)
      .values({
        panelUuid: s.uuid,
        identifier: s.identifier,
        name: s.name,
        gameId: game.id,
      })
      .returning({ id: schema.pelicanServers.id }),
    'server',
  );
  serverId = server.id;
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: game.id,
        region: 'us',
        name: 'Death Hub',
        nameKey: 'death-hub',
        source: 'addon_import',
      })
      .returning({ id: schema.guilds.id }),
    'guild',
  );
  guildId = g.id;
}

/** One stored death picture (hub_media row) — the FK target of a link. */
async function media(): Promise<number> {
  mediaSeq += 1;
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.hubMedia)
      .values({
        guildId,
        source: 'discord',
        kind: 'death',
        provenanceKey: `discord:1:${mediaSeq}:a`,
        capturedAt: T,
        storageName: `storage-${mediaSeq}`,
        width: 10,
        height: 10,
        bytes: 100,
      })
      .returning({ id: schema.hubMedia.id }),
    'media',
  );
  return row.id;
}

const post = (
  hubMediaId: number,
  over: Partial<DeathPostInput> = {},
): DeathPostInput => ({
  pelicanServerId: serverId,
  characterName: 'Bjorn',
  postedAt: T,
  hubMediaId,
  captureSecondOfHour: null,
  ...over,
});

const logDeath = (offsetSec: number, name = 'Bjorn'): LogDeathInput => ({
  characterName: name,
  steamId: null,
  loggedAt: at(offsetSec).toISOString().slice(0, 19),
  occurredAt: at(offsetSec),
});

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  await seedServerAndHub();
});

describe('death post → log death (integration)', () => {
  it('infers one discord death, then the log death merges into it', async () => {
    const m = await media();
    const first = await links().linkOrInferDeath(post(m));
    expect(first.outcome).toBe('inferred');
    const inserted = await logs().recordLogDeath(serverId, {
      ...logDeath(30, 'BJORN'),
      steamId: '76561190000000001',
    });
    expect(inserted).toBe(false);
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      id: first.deathId,
      source: 'log',
      characterName: 'BJORN',
      hubMediaId: m,
      steamId: '76561190000000001',
      occurredAt: at(30),
    });
  });

  it('a replayed log line after the merge adds nothing', async () => {
    await links().linkOrInferDeath(post(await media()));
    const death = logDeath(10);
    expect(await logs().recordLogDeath(serverId, death)).toBe(false);
    expect(await logs().recordLogDeath(serverId, death)).toBe(false);
    expect(await rows()).toHaveLength(1);
  });

  it('a log death outside the window does not merge', async () => {
    await links().linkOrInferDeath(post(await media()));
    expect(await logs().recordLogDeath(serverId, logDeath(W + 1))).toBe(true);
    expect((await rows()).map((r) => r.source)).toEqual(['discord', 'log']);
  });
});

describe('log death → death post (integration)', () => {
  it('links the recorded death and reports the delta', async () => {
    expect(await logs().recordLogDeath(serverId, logDeath(-45))).toBe(true);
    const m = await media();
    const res = await links().linkOrInferDeath(
      post(m, { characterName: 'bjorn' }),
    );
    expect(res).toMatchObject({ outcome: 'linked', deltaSec: -45 });
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ source: 'log', hubMediaId: m });
  });

  it('re-ingesting the same media is `already` and writes nothing', async () => {
    await logs().recordLogDeath(serverId, logDeath(5));
    const m = await media();
    const first = await links().linkOrInferDeath(post(m));
    const again = await links().linkOrInferDeath(post(m));
    expect(again).toEqual({
      outcome: 'already',
      deathId: first.deathId,
      deltaSec: null,
    });
    expect(await rows()).toHaveLength(1);
  });

  it('a second post for one death infers a second death', async () => {
    await logs().recordLogDeath(serverId, logDeath(5));
    await links().linkOrInferDeath(post(await media()));
    const second = await links().linkOrInferDeath(post(await media()));
    expect(second.outcome).toBe('inferred');
    expect((await rows()).map((r) => r.source)).toEqual(['log', 'discord']);
  });

  it.each([
    ['+W', W, 'linked'],
    ['-W', -W, 'linked'],
    ['+W+1', W + 1, 'inferred'],
    ['-W-1', -W - 1, 'inferred'],
  ])('a log death at %s is %s', async (_label, offset, outcome) => {
    await logs().recordLogDeath(serverId, logDeath(offset));
    const res = await links().linkOrInferDeath(post(await media()));
    expect(res.outcome).toBe(outcome);
  });

  it('breaks an equal-distance tie on the capture mm:ss (D15)', async () => {
    await logs().recordLogDeath(serverId, logDeath(-30));
    await logs().recordLogDeath(serverId, logDeath(30));
    const m = await media();
    // T+30 s is 12:00:30 → second-of-hour 30.
    await links().linkOrInferDeath(post(m, { captureSecondOfHour: 30 }));
    const linked = (await rows()).find((r) => r.hubMediaId === m);
    expect(linked?.occurredAt).toEqual(at(30));
  });

  it('never links a death on another name', async () => {
    await logs().recordLogDeath(serverId, logDeath(5, 'Astrid'));
    const res = await links().linkOrInferDeath(post(await media()));
    expect(res.outcome).toBe('inferred');
    expect(await rows()).toHaveLength(2);
  });
});

describe("a message's pictures share one death (Codex P2)", () => {
  it('moves a death linked to a sibling picture of the same message, never infers a second', async () => {
    await logs().recordLogDeath(serverId, logDeath(-30));
    const [a, b] = [await media(), await media()];
    await testApp.db
      .update(schema.hubMedia)
      .set({ discordMessageId: '42' })
      .where(inArray(schema.hubMedia.id, [a, b]));
    expect((await links().linkOrInferDeath(post(a))).outcome).toBe('linked');
    const moved = await links().linkOrInferDeath(post(b));
    expect(moved.outcome).toBe('already');
    expect((await rows()).map((r) => [r.source, r.hubMediaId])).toEqual([
      ['log', b],
    ]);
  });

  it('a tombstoned picture links and infers nothing', async () => {
    await logs().recordLogDeath(serverId, logDeath(-30));
    const m = await media();
    await testApp.db
      .update(schema.hubMedia)
      .set({ removedAt: new Date() })
      .where(eq(schema.hubMedia.id, m));
    expect((await links().linkOrInferDeath(post(m))).outcome).toBe('gone');
    expect((await rows()).map((r) => [r.source, r.hubMediaId])).toEqual([
      ['log', null],
    ]);
  });
});

describe('concurrent post + log (integration)', () => {
  it('counts the death once whichever statement wins', async () => {
    const names = ['Ari', 'Bo', 'Cy', 'Di', 'Ed', 'Fi', 'Gu', 'Hal'];
    const cases = await Promise.all(
      names.map(async (name, i) => ({ name, i, m: await media() })),
    );
    await Promise.all(
      cases.flatMap(({ name, i, m }) => [
        links().linkOrInferDeath(post(m, { characterName: name })),
        logs().recordLogDeath(serverId, logDeath(i, name)),
      ]),
    );
    const all = await rows();
    expect(all).toHaveLength(names.length);
    expect(all.every((r) => r.source === 'log' && r.hubMediaId !== null)).toBe(
      true,
    );
  });
});
