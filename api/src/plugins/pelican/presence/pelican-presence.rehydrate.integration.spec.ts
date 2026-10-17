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
  SERVER_PRESENCE_READER,
  type ServerPresenceReader,
} from './server-presence.reader';
import {
  SERVER_PRESENCE_SINK,
  type ServerPresenceSink,
  type ServerPresenceSource,
} from './server-presence.sink';

const t = schema.adHocParticipants;
const STEAM_A = '76561198000000221';
const STEAM_B = '76561198000000222';
const STEAM_C = '76561198000000223';

let testApp: TestApp;
let sink: ServerPresenceSink;
let serverSeq = 9800;

const steamRows = (eventId: number, steamId: string) =>
  testApp.db
    .select()
    .from(t)
    .where(and(eq(t.eventId, eventId), eq(t.steamId, steamId)));

/** A live Quick Play of `src`'s game with nobody on it yet. */
async function seedLiveEvent(src: ServerPresenceSource): Promise<number> {
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
  return event.id;
}

/** A live Quick Play with STEAM_A (linked to "RokRL") on the server as "rok". */
async function seedLinkedOnServer(
  src: ServerPresenceSource,
  characterOwnerId?: string,
): Promise<number> {
  const eventId = await seedLiveEvent(src);
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ username: 'rok-user', displayName: 'RokRL', steamId: STEAM_A })
      .returning(),
    'user',
  );
  await testApp.app.get(AdHocParticipantService).addServerParticipant(eventId, {
    steamId: STEAM_A,
    displayName: 'rok',
    userId: user.id,
    pelicanServerId: src.pelicanServerId,
    ...(characterOwnerId ? { characterOwnerId } : {}),
  });
  return eventId;
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

/** One player arriving: a join, then the character line that names them. */
const at = (s: number) => `2026-10-17T10:00:${String(s).padStart(2, '0')}`;
const arrival = (steamId: string, name: string, ownerId: string, s: number) => [
  line({ kind: 'join', steamId, loggedAt: at(s) }),
  line({
    kind: 'character',
    name,
    zdoidZero: false,
    ownerId,
    loggedAt: at(s + 1),
  }),
];

/** Replay `lines` as a cold start's post-auth burst, then let the sink settle. */
async function coldReplay(
  wings: ReturnType<typeof fakeWings>,
  session: PelicanPresenceSession,
  lines: string[],
) {
  await socketOpened(wings);
  wings.authenticate();
  wings.lines(lines);
  // A re-auth flushes the buffered replay synchronously (no settle timer).
  wings.authenticate();
  await session.idle();
}

describe('Presence session — a cold replay enrol persists the character owner (ROK-1828)', () => {
  let reader: ServerPresenceReader;
  let current: PelicanPresenceSession | null = null;

  beforeAll(() => {
    reader = testApp.app.get<ServerPresenceReader>(SERVER_PRESENCE_READER, {
      strict: false,
    });
  });

  // The supervisor never sees these hand-built sessions: point the tracker
  // read port (what `enrolTracked` reads) at whichever one is running.
  beforeEach(() => {
    jest
      .spyOn(reader, 'playersForGame')
      .mockImplementation((gameId) =>
        (current?.players() ?? []).filter((p) => p.gameId === gameId),
      );
  });

  afterEach(() => {
    current = null;
    jest.mocked(reader.playersForGame).mockRestore();
  });

  it("every replay-enrolled row keeps its owner, so after a restart a stranger's same-named character is not a respawn", async () => {
    const src = newSource();
    const eventId = await seedLiveEvent(src);
    const first = startSession(src);
    current = first.session;
    await first.session.start();
    // A's queued join runs enrolTracked, which attaches B from the tracker
    // before B's own join — that join then skips the already-open row.
    await coldReplay(first.wings, first.session, [
      ...arrival(STEAM_A, 'rok', 'zdo-owner-a', 1),
      ...arrival(STEAM_B, 'bob', 'zdo-owner-b', 3),
    ]);
    const owners = async (steamId: string) =>
      (await steamRows(eventId, steamId)).map((r) => [
        r.characterName,
        r.characterOwnerId,
      ]);
    expect(await owners(STEAM_A)).toEqual([['rok', 'zdo-owner-a']]);
    expect(await owners(STEAM_B)).toEqual([['bob', 'zdo-owner-b']]);
    await first.session.stop(false);

    const second = startSession(src);
    current = second.session;
    await second.session.start();
    await coldReplay(
      second.wings,
      second.session,
      arrival(STEAM_C, 'bob', 'zdo-owner-c', 5),
    );

    // Rehydrate reads open rows without an ORDER BY, so compare by SteamID.
    const roster = second.session
      .players()
      .map((p) => [p.steamId, p.name])
      .sort(([a], [b]) => String(a).localeCompare(String(b)));
    expect(roster).toEqual([
      [STEAM_A, 'rok'],
      [STEAM_B, 'bob'],
      [STEAM_C, 'bob'],
    ]);
    expect(await owners(STEAM_C)).toEqual([['bob', 'zdo-owner-c']]);
    expect(await owners(STEAM_B)).toEqual([['bob', 'zdo-owner-b']]);
    await second.session.stop(false);
  });
});
