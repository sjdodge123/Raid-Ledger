/**
 * ROK-1822 (Codex P2 on ROK-1821) — a restart must not mis-attribute a
 * character line. A linked row shows the Raid Ledger name, so its character
 * name lives in `ad_hoc_participants.character_name`; a session rehydrate
 * restores it, and a pending handshake can no longer take a character line
 * that belongs to the rehydrated player. Real DB, real sink, a hand-driven
 * Wings socket.
 */
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { AdHocParticipantService } from '../../../discord-bot/services/ad-hoc-participant.service';
import { SettingsService } from '../../../settings/settings.service';
import { PelicanPresenceSession } from './pelican-presence.session';
import {
  fakeLogger,
  fakeParser,
  fakeWings,
  line,
  okCredentials,
} from './pelican-presence.spec-fakes';
import {
  SERVER_PRESENCE_SINK,
  type ServerPresenceSink,
  type ServerPresenceSource,
} from './server-presence.sink';

const t = schema.adHocParticipants;
const STEAM_A = '76561198000000221';
const STEAM_B = '76561198000000222';

let testApp: TestApp;
let sink: ServerPresenceSink;
let serverSeq = 9800;

const steamRows = (eventId: number, steamId: string) =>
  testApp.db
    .select()
    .from(t)
    .where(and(eq(t.eventId, eventId), eq(t.steamId, steamId)));

/** A live Quick Play with STEAM_A (linked to "RokRL") on the server as "rok". */
async function seedLinkedOnServer(
  src: ServerPresenceSource,
  characterOwnerId?: string,
): Promise<number> {
  const now = new Date();
  const [event] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: 'Quick Play',
        creatorId: testApp.seed.adminUser.id,
        gameId: src.gameId,
        duration: [now, new Date(now.getTime() + 3_600_000)],
        isAdHoc: true,
        adHocStatus: 'live',
      })
      .returning(),
    'event',
  );
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ username: 'rok-user', displayName: 'RokRL', steamId: STEAM_A })
      .returning(),
    'user',
  );
  await testApp.app
    .get(AdHocParticipantService)
    .addServerParticipant(event.id, {
      steamId: STEAM_A,
      displayName: 'rok',
      userId: user.id,
      pelicanServerId: src.pelicanServerId,
      ...(characterOwnerId ? { characterOwnerId } : {}),
    });
  return event.id;
}

function startSession(src: ServerPresenceSource) {
  const wings = fakeWings();
  const session = new PelicanPresenceSession({
    source: src,
    serverIdentifier: 'srv-1822',
    panelUrl: 'https://panel.example.test',
    getCredentials: okCredentials,
    parser: fakeParser,
    sink,
    logger: fakeLogger(),
    socketFactory: wings.factory,
  });
  return { wings, session };
}

/** The socket opens after an async credentials fetch; wait for it. */
async function socketOpened(wings: ReturnType<typeof fakeWings>) {
  for (let i = 0; i < 50 && wings.sockets.length === 0; i++)
    await new Promise((resolve) => setImmediate(resolve));
  expect(wings.sockets).toHaveLength(1);
}

beforeAll(async () => {
  testApp = await getTestApp();
  sink = testApp.app.get<ServerPresenceSink>(SERVER_PRESENCE_SINK, {
    strict: false,
  });
});

// The sink drops every server join while Quick Play is switched off, so a
// new player's row (and the absence assertions) only mean something with it on.
beforeEach(async () => {
  await testApp.app
    .get(SettingsService)
    .set(schema.SETTING_KEYS.AD_HOC_EVENTS_ENABLED, 'true');
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

const newSource = (): ServerPresenceSource => ({
  pelicanServerId: ++serverSeq,
  gameId: testApp.seed.game.id,
});

describe('Presence session rehydrate — linked character names (ROK-1822)', () => {
  it('a linked row persists its character name and the rehydrated tracker is named by it', async () => {
    const src = newSource();
    const eventId = await seedLinkedOnServer(src);
    const [row] = nonEmpty(await steamRows(eventId, STEAM_A), 'linked row');
    expect([row.discordUsername, row.characterName]).toEqual(['RokRL', 'rok']);

    const { session } = startSession(src);
    await session.start();
    await session.idle();

    expect(session.players().map((p) => [p.steamId, p.name])).toEqual([
      [STEAM_A, 'rok'],
    ]);
    await session.stop(false);
  });

  it("a pending handshake does not take a rehydrated linked player's character line", async () => {
    const src = newSource();
    const eventId = await seedLinkedOnServer(src);
    const { wings, session } = startSession(src);
    await session.start();
    await socketOpened(wings);
    wings.authenticate();
    wings.lines([
      line({ kind: 'join', steamId: STEAM_B, loggedAt: '2026-10-17T10:00:01' }),
      line({
        kind: 'character',
        name: 'rok',
        zdoidZero: false,
        loggedAt: '2026-10-17T10:00:02',
      }),
    ]);
    // A re-auth flushes the buffered replay synchronously (no settle timer).
    wings.authenticate();
    await session.idle();

    expect(session.players().map((p) => [p.steamId, p.name])).toEqual([
      [STEAM_A, 'rok'],
    ]);
    expect(await steamRows(eventId, STEAM_B)).toEqual([]);
    const [row] = nonEmpty(await steamRows(eventId, STEAM_A), 'linked row');
    expect(row.characterName).toBe('rok');
    await session.stop(false);
  });
});

describe('Presence session rehydrate — character owner ids (ROK-1822 r3)', () => {
  it("a new player's same-named character is not taken as the rehydrated linked player's respawn (r3)", async () => {
    const src = newSource();
    const eventId = await seedLinkedOnServer(src, 'zdo-owner-a');
    const [seeded] = nonEmpty(await steamRows(eventId, STEAM_A), 'linked row');
    expect([seeded.characterName, seeded.characterOwnerId]).toEqual([
      'rok',
      'zdo-owner-a',
    ]);

    const { wings, session } = startSession(src);
    await session.start();
    await socketOpened(wings);
    wings.authenticate();
    wings.lines([
      line({ kind: 'join', steamId: STEAM_B, loggedAt: '2026-10-17T10:00:01' }),
      line({
        kind: 'character',
        name: 'rok',
        zdoidZero: false,
        ownerId: 'zdo-owner-b',
        loggedAt: '2026-10-17T10:00:02',
      }),
    ]);
    wings.authenticate();
    await session.idle();

    expect(session.players().map((p) => [p.steamId, p.name])).toEqual([
      [STEAM_A, 'rok'],
      [STEAM_B, 'rok'],
    ]);
    const [rowB] = nonEmpty(await steamRows(eventId, STEAM_B), 'new row');
    expect([rowB.characterName, rowB.characterOwnerId]).toEqual([
      'rok',
      'zdo-owner-b',
    ]);
    const [rowA] = nonEmpty(await steamRows(eventId, STEAM_A), 'linked row');
    expect([rowA.characterName, rowA.characterOwnerId]).toEqual([
      'rok',
      'zdo-owner-a',
    ]);
    await session.stop(false);
  });
});
