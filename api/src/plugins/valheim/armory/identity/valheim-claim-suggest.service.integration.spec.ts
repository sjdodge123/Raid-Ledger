/**
 * ROK-1933 L2 — the suggested-claim DM scan against a real database and the
 * app's Redis (the in-memory REDIS_CLIENT mock every integration spec shares).
 *
 * The scan runs for real end to end: the L1 queries, the pure pick, the three
 * `NotificationDedupService` keys, and the real
 * `DiscordNotificationService.dispatch` with its opt-out, deactivation,
 * snowflake and rate-limit gates. Only the boundary past it is stubbed: the
 * bot reports itself connected and `send-dm` jobs never reach the BullMQ
 * worker (which would try to DM through a client that does not exist).
 *
 * Character and user names are invented.
 */
import { Job, type Queue } from 'bullmq';
import { ValheimCharacterMessageSchema } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../../common/testing/test-app';
import { truncateAllTables } from '../../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../../common/testing/narrow';
import * as schema from '../../../../drizzle/schema';
import { DEFAULT_CHANNEL_PREFS } from '../../../../drizzle/schema/notification-preferences';
import { DiscordBotClientService } from '../../../../discord-bot/discord-bot-client.service';
import { DiscordNotificationService } from '../../../../notifications/discord-notification.service';
import { NotificationDedupService } from '../../../../notifications/notification-dedup.service';
import { fakeServer } from '../../../pelican/testing/pelican-fixtures';
import { loadValheimFixture } from '../../link/ingest/valheim-link-ingest.testing';
import { claimSuggestKeys } from './valheim-claim-suggest.copy';
import {
  CLAIM_SUGGEST_TYPE,
  ValheimClaimSuggestService,
} from './valheim-claim-suggest.service';

const STEAM_A = '76561190000000201';
const STEAM_B = '76561190000000202';
const BRANNOK = 'Brannök';
const YSOLDE = 'Ysolde';
const MIN = 60_000;
/** Redis keys this spec writes that the shared truncate does not purge. */
const REDIS_PREFIXES = ['valheim-claim-suggest', 'discord-notif:rate:'];

let testApp: TestApp;
let seq = 0;
let dispatchSpy: jest.SpiedFunction<DiscordNotificationService['dispatch']>;
let connectedSpy: jest.SpiedFunction<DiscordBotClientService['isConnected']>;
let addSpy: jest.SpiedFunction<Queue['add']>;

interface World {
  serverId: number;
  guildId: number;
  eventId: number;
}

const service = () => testApp.app.get(ValheimClaimSuggestService);
const dedup = () => testApp.app.get(NotificationDedupService);
const scan = () => service().scan(new Date());

async function insertServer(): Promise<number> {
  seq += 1;
  const s = fakeServer(500 + seq);
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

async function insertHub(serverId: number): Promise<number> {
  const name = `Skarnheim ${serverId}`;
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: testApp.seed.game.id,
        kind: 'game_server',
        name,
        nameKey: name.toLowerCase(),
        region: 'server',
        source: 'pelican',
        pelicanServerId: serverId,
      })
      .returning({ id: schema.guilds.id }),
    'hub',
  );
  return row.id;
}

async function insertQuickPlay(): Promise<number> {
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: 'Quick Play',
        creatorId: testApp.seed.adminUser.id,
        gameId: testApp.seed.game.id,
        duration: [new Date(Date.now() - 60 * MIN), new Date()],
        isAdHoc: true,
        adHocStatus: 'live',
      })
      .returning({ id: schema.events.id }),
    'event',
  );
  return row.id;
}

/** A server, its visible hub and a live Quick Play on it. */
async function world(): Promise<World> {
  const serverId = await insertServer();
  return {
    serverId,
    guildId: await insertHub(serverId),
    eventId: await insertQuickPlay(),
  };
}

async function insertProfile(
  w: World,
  name: string,
  steamId: string,
): Promise<number> {
  const ch = ValheimCharacterMessageSchema.parse(
    loadValheimFixture('character-vanilla'),
  );
  seq += 1;
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.valheimProfiles)
      .values({
        pelicanServerId: w.serverId,
        steamId,
        playerId: `${7000 + seq}`,
        worldUid: '1234567890123',
        worldName: 'W',
        name,
        gameVersion: '0.220.5',
        modVersion: '1.0.0',
        capturedAt: new Date(),
        equipment: ch.equipment,
        inventory: ch.inventory,
        skills: ch.skills,
        trophies: [],
        knownItems: [],
        knownRecipes: [],
      })
      .returning({ id: schema.valheimProfiles.id }),
    'profile',
  );
  return row.id;
}

/**
 * An unclaimed character a Steam-only player has been playing for 20
 * minutes in the world's live Quick Play — one qualifying sighting.
 *
 * @returns The character's profile id.
 */
async function playing(
  w: World,
  name = BRANNOK,
  steamId = STEAM_A,
): Promise<number> {
  const profileId = await insertProfile(w, name, steamId);
  await testApp.db.insert(schema.adHocParticipants).values({
    eventId: w.eventId,
    steamId,
    discordUsername: name,
    characterName: name,
    source: 'steam',
    inVoice: false,
    onServer: true,
    pelicanServerId: w.serverId,
    joinedAt: new Date(Date.now() - 20 * MIN),
  });
  return profileId;
}

/** An 18-digit Discord snowflake, unique per call. */
function snowflake(): string {
  seq += 1;
  return `1${String(seq).padStart(17, '0')}`;
}

async function insertUser(
  username: string,
  opts: {
    displayName?: string;
    deactivated?: boolean;
    discordId?: string;
  } = {},
): Promise<number> {
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        username,
        discordId: opts.discordId ?? snowflake(),
        displayName: opts.displayName ?? null,
        deactivatedAt: opts.deactivated === true ? new Date() : null,
      })
      .returning({ id: schema.users.id }),
    `user ${username}`,
  );
  return row.id;
}

/** A user who is a current member of the world's hub. */
async function member(
  w: World,
  username: string,
  opts: Parameters<typeof insertUser>[1] = {},
): Promise<number> {
  const userId = await insertUser(username, opts);
  await testApp.db.insert(schema.hubServerMembers).values({
    guildId: w.guildId,
    userId,
    source: 'manual',
    joinedAt: new Date(),
  });
  return userId;
}

/** Turn the claim-suggestion DM off (Discord channel) for a user. */
async function optOut(userId: number): Promise<void> {
  await testApp.db.insert(schema.userNotificationPreferences).values({
    userId,
    channelPrefs: {
      ...DEFAULT_CHANNEL_PREFS,
      [CLAIM_SUGGEST_TYPE]: { inApp: false, push: false, discord: false },
    },
  });
}

/** The three keys a DM to `userId` about `profileId` claims. */
const keysOf = (profileId: number, userId: number): string[] => [
  claimSuggestKeys.profile(profileId),
  claimSuggestKeys.user(userId),
  claimSuggestKeys.pair(profileId, userId),
];

/** Which of `keys` are held, in order. */
const held = (keys: readonly string[]): Promise<boolean[]> =>
  Promise.all(keys.map((k) => dedup().isMarked(k)));

/** Let the two 24h keys lapse (both stores), as a day passing would. */
async function lapseDailyKeys(profileId: number, userId: number) {
  await dedup().releaseKey(claimSuggestKeys.profile(profileId));
  await dedup().releaseKey(claimSuggestKeys.user(userId));
  clearRedis(['discord-notif:rate:']);
}

function clearRedis(prefixes: readonly string[]): void {
  const store = testApp.redisMock.store;
  for (const key of [...store.keys()]) {
    if (prefixes.some((p) => key.startsWith(p))) store.delete(key);
  }
}

/** The user ids `dispatch` was asked to DM, in call order. */
const dispatchedTo = (): number[] =>
  dispatchSpy.mock.calls.map(([input]) => input.userId);

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(() => {
  connectedSpy = jest
    .spyOn(testApp.app.get(DiscordBotClientService), 'isConnected')
    .mockReturnValue(true);
  const discord = testApp.app.get(DiscordNotificationService);
  dispatchSpy = jest.spyOn(discord, 'dispatch');
  // The queue `dispatch` actually enqueues on. Not `app.get(getQueueToken(…))`:
  // AdminModule and NotificationModule each call `BullModule.registerQueue`
  // for this name, and Nest 11 keys dynamic modules by reference, so there are
  // two Queue instances and `strict: false` returns AdminModule's.
  const queue: Queue = discord['queue'];
  addSpy = jest
    .spyOn(queue, 'add')
    .mockImplementation((name, data) =>
      Promise.resolve(new Job(queue, name, data)),
    );
});

afterEach(async () => {
  jest.restoreAllMocks();
  clearRedis(REDIS_PREFIXES);
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('ValheimClaimSuggestService.scan — the DM', () => {
  it('queues one claim DM to the top candidate, with the hub link', async () => {
    const w = await world();
    const profileId = await playing(w);
    const userId = await member(w, 'brannok');

    expect(await scan()).toBe(1);

    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(addSpy).toHaveBeenCalledWith(
      'send-dm',
      expect.objectContaining({
        notificationId: `vclaim-${profileId}-${userId}`,
        userId,
        type: CLAIM_SUGGEST_TYPE,
        title: `Is ${BRANNOK} yours?`,
        payload: expect.objectContaining({
          profileId,
          guildId: w.guildId,
          characterName: BRANNOK,
          hubUrl: expect.stringMatching(
            new RegExp(`/hubs/${w.guildId}#characters$`),
          ),
        }),
      }),
      expect.anything(),
    );
    expect(await held(keysOf(profileId, userId))).toEqual([true, true, true]);
  });

  it('picks the strongest name match over a weaker one', async () => {
    const w = await world();
    await playing(w);
    const strong = await member(w, 'brannok');
    await member(w, 'brannokk');

    expect(await scan()).toBe(1);
    expect(dispatchedTo()).toEqual([strong]);
  });
});

describe('ValheimClaimSuggestService.scan — dedupe', () => {
  it('asks a user about a character once, even after the 24h keys lapse', async () => {
    const w = await world();
    const profileId = await playing(w);
    const userId = await member(w, 'brannok');
    expect(await scan()).toBe(1);

    await lapseDailyKeys(profileId, userId);
    expect(await held(keysOf(profileId, userId))).toEqual([false, false, true]);

    expect(await scan()).toBe(0);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(addSpy).toHaveBeenCalledTimes(1);
  });

  it('caps a user at one claim DM per 24h across characters', async () => {
    const w = await world();
    const first = await playing(w, BRANNOK, STEAM_A);
    const second = await playing(w, YSOLDE, STEAM_B);
    const userId = await member(w, 'brannok', { displayName: YSOLDE });

    expect(await scan()).toBe(1);

    expect(dispatchedTo()).toEqual([userId]);
    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(await held(keysOf(first, userId))).toEqual([true, true, true]);
    // The second character's own 24h slot is given back, not burnt.
    expect(await held([claimSuggestKeys.profile(second)])).toEqual([false]);
    expect(await held([claimSuggestKeys.pair(second, userId)])).toEqual([
      false,
    ]);
  });
});

describe('ValheimClaimSuggestService.scan — a send that did not go', () => {
  it.each<[string, () => void]>([
    [
      'the queue rejects the job',
      () => {
        addSpy.mockRejectedValueOnce(new Error('queue unavailable'));
      },
    ],
    [
      'the bot is offline',
      () => {
        connectedSpy.mockReturnValue(false);
      },
    ],
    [
      'dispatch throws',
      () => {
        dispatchSpy.mockRejectedValueOnce(new Error('dispatch failed'));
      },
    ],
  ])(
    'releases all three keys when %s, so the next scan retries',
    async (_label, breakSend) => {
      const w = await world();
      const profileId = await playing(w);
      const userId = await member(w, 'brannok');
      breakSend();

      expect(await scan()).toBe(0);
      expect(await held(keysOf(profileId, userId))).toEqual([
        false,
        false,
        false,
      ]);

      connectedSpy.mockReturnValue(true);
      clearRedis(['discord-notif:rate:']);
      expect(await scan()).toBe(1);
      expect(await held(keysOf(profileId, userId))).toEqual([true, true, true]);
    },
  );
});

describe('ValheimClaimSuggestService.scan — skipped users', () => {
  it('skips a user who turned the DM off, and frees the keys', async () => {
    const w = await world();
    const profileId = await playing(w);
    const userId = await member(w, 'brannok');
    await optOut(userId);

    expect(await scan()).toBe(0);

    expect(dispatchedTo()).toEqual([userId]);
    await expect(dispatchSpy.mock.results[0]?.value).resolves.toBe(false);
    expect(addSpy).not.toHaveBeenCalled();
    expect(await held(keysOf(profileId, userId))).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('skips a user without a Discord snowflake, and frees the keys', async () => {
    const w = await world();
    const profileId = await playing(w);
    const userId = await member(w, 'brannok', {
      discordId: 'local:brannok@claim.test',
    });

    expect(await scan()).toBe(0);

    expect(addSpy).not.toHaveBeenCalled();
    expect(await held(keysOf(profileId, userId))).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('never DMs a deactivated user; the next active match is asked', async () => {
    const w = await world();
    const profileId = await playing(w);
    const gone = await member(w, 'brannok', { deactivated: true });
    const active = await member(w, 'brannokk');

    expect(await scan()).toBe(1);

    expect(dispatchedTo()).toEqual([active]);
    expect(await held([claimSuggestKeys.pair(profileId, gone)])).toEqual([
      false,
    ]);
    expect(await held([claimSuggestKeys.user(gone)])).toEqual([false]);
  });

  it('sends nothing when the only match is deactivated', async () => {
    const w = await world();
    const profileId = await playing(w);
    const gone = await member(w, 'brannok', { deactivated: true });

    expect(await scan()).toBe(0);

    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(await held(keysOf(profileId, gone))).toEqual([false, false, false]);
  });
});

describe('ValheimClaimSuggestService.scan — Not me', () => {
  it('never picks a user who declined; the next match is asked', async () => {
    const w = await world();
    const profileId = await playing(w);
    const declined = await member(w, 'brannok');
    const next = await member(w, 'brannokk');
    await dedup().checkAndMarkSent(
      claimSuggestKeys.declined(profileId, declined),
      null,
    );

    expect(await scan()).toBe(1);

    expect(dispatchedTo()).toEqual([next]);
    expect(await held([claimSuggestKeys.pair(profileId, declined)])).toEqual([
      false,
    ]);
  });

  it('sends nothing when the only match declined', async () => {
    const w = await world();
    const profileId = await playing(w);
    const declined = await member(w, 'brannok');
    await dedup().checkAndMarkSent(
      claimSuggestKeys.declined(profileId, declined),
      null,
    );

    expect(await scan()).toBe(0);

    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(await held(keysOf(profileId, declined))).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('a decline on one character does not suppress another', async () => {
    const w = await world();
    const declinedOn = await playing(w, YSOLDE, STEAM_B);
    const profileId = await playing(w, BRANNOK, STEAM_A);
    const userId = await member(w, 'brannok', { displayName: YSOLDE });
    await dedup().checkAndMarkSent(
      claimSuggestKeys.declined(declinedOn, userId),
      null,
    );

    expect(await scan()).toBe(1);

    expect(addSpy).toHaveBeenCalledWith(
      'send-dm',
      expect.objectContaining({
        userId,
        payload: expect.objectContaining({ profileId }),
      }),
      expect.anything(),
    );
  });
});
