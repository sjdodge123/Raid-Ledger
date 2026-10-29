/**
 * ROK-1930 L1 (AC1) — console deaths stored against a real database: the
 * recorder + tracker in the session's order (observe, then apply) over
 * real Valheim log lines, into the bound SERVER_DEATH_SINK.
 */
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { fakeServer } from '../../pelican/testing/pelican-fixtures';
import { PresenceDeathRecorder } from '../../pelican/presence/pelican-presence.deaths';
import {
  SERVER_DEATH_SINK,
  type ServerDeathSink,
} from '../../pelican/presence/server-death.sink';
import { ServerPresenceTracker } from '../../pelican/presence/server-presence.tracker';
import { parseValheimLine } from '../valheim-presence.parser';
import { VALHEIM_GAME_SLUG } from '../valheim.constants';
import { ValheimDeathSink } from './valheim-deaths.sink';
import { ValheimDeathsRepository } from './valheim-deaths.repository';

const STEAM_A = '76561190000000001';
let testApp: TestApp;

async function makeServer(slug: string, n: number) {
  const [game] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: `Game ${slug}`, slug })
      .returning({ id: schema.games.id }),
    'game',
  );
  const s = fakeServer(n);
  const [row] = nonEmpty(
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
  return { pelicanServerId: row.id, gameId: game.id };
}

const sink = (): ServerDeathSink => testApp.app.get(SERVER_DEATH_SINK);
const rows = () => testApp.db.select().from(schema.valheimPlayerDeaths);

/** One console buffer through a fresh tracker (a cold start), like a replay. */
async function replay(
  source: { pelicanServerId: number; gameId: number },
  lines: string[],
): Promise<void> {
  const tracker = new ServerPresenceTracker();
  const calls: Array<Promise<void>> = [];
  const recorder = new PresenceDeathRecorder({
    source,
    sink: sink(),
    logger: { warn: () => undefined },
    enqueue: (_m, call) => calls.push(call()),
  });
  const at = new Date();
  for (const raw of lines) {
    const event = parseValheimLine(raw);
    if (!event) continue;
    recorder.observe(event, tracker, at);
    tracker.apply(event, at);
  }
  await Promise.all(calls);
}

const HANDSHAKE = `10/14/2026 02:40:00: Got handshake from client ${STEAM_A}`;
const SPAWN =
  '10/14/2026 02:40:05: Got character ZDOID from Bjorn : 123456789:1';
const DEATH = '10/14/2026 02:45:04: Got character ZDOID from Bjorn : 0:0';
const RESPAWN =
  '10/14/2026 02:45:20: Got character ZDOID from Bjorn : 123456789:7';

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('Valheim deaths persistence (integration)', () => {
  it('binds the Valheim sink under SERVER_DEATH_SINK', () => {
    expect(sink()).toBeInstanceOf(ValheimDeathSink);
  });

  it('stores one attributed row per death, never the respawn', async () => {
    const src = await makeServer(VALHEIM_GAME_SLUG, 1);
    await replay(src, [HANDSHAKE, SPAWN, DEATH, RESPAWN]);
    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      pelicanServerId: src.pelicanServerId,
      characterName: 'Bjorn',
      steamId: STEAM_A,
      source: 'log',
      loggedAt: '2026-10-14T02:45:04',
    });
    // No server or community timezone → the stamp is read as UTC.
    expect(stored[0]?.occurredAt.toISOString()).toBe(
      '2026-10-14T02:45:04.000Z',
    );
  });

  it('a respawn-only sequence stores nothing', async () => {
    const src = await makeServer(VALHEIM_GAME_SLUG, 1);
    await replay(src, [HANDSHAKE, SPAWN, RESPAWN]);
    expect(await rows()).toHaveLength(0);
  });

  it('a cold-start replay of the same buffer twice adds no rows', async () => {
    const src = await makeServer(VALHEIM_GAME_SLUG, 1);
    const buffer = [HANDSHAKE, SPAWN, DEATH, RESPAWN];
    await replay(src, buffer);
    await replay(src, buffer);
    expect(await rows()).toHaveLength(1);
  });
});

describe('Valheim deaths dedupe + attribution (integration)', () => {
  it('the same (server, name, loggedAt) inserted twice is one row', async () => {
    const { pelicanServerId } = await makeServer(VALHEIM_GAME_SLUG, 1);
    const repo = testApp.app.get(ValheimDeathsRepository);
    const death = {
      characterName: 'Bjorn',
      steamId: null,
      loggedAt: '2026-10-14T02:45:04',
      occurredAt: new Date('2026-10-14T02:45:04Z'),
    };
    expect(await repo.recordLogDeath(pelicanServerId, death)).toBe(true);
    expect(await repo.recordLogDeath(pelicanServerId, death)).toBe(false);
    expect(await rows()).toHaveLength(1);
  });

  it('a later attributed replay fills a NULL steam_id, never overwrites one', async () => {
    const src = await makeServer(VALHEIM_GAME_SLUG, 1);
    await replay(src, [DEATH]); // no handshake yet → unattributed
    expect((await rows())[0]?.steamId).toBeNull();
    await replay(src, [HANDSHAKE, SPAWN, DEATH]);
    expect((await rows())[0]?.steamId).toBe(STEAM_A);
    const other = '76561190000000002';
    await replay(src, [
      `10/14/2026 02:40:00: Got handshake from client ${other}`,
      SPAWN,
      DEATH,
    ]);
    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.steamId).toBe(STEAM_A);
  });

  it('a non-Valheim server stores nothing', async () => {
    const src = await makeServer('not-valheim', 2);
    await replay(src, [HANDSHAKE, SPAWN, DEATH]);
    expect(await rows()).toHaveLength(0);
  });
});
