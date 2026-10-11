/**
 * ROK-1766 — Quick Play Announcements posting against a real database.
 *
 * The unit spec mocks drizzle, so what can only break HERE is unasserted
 * elsewhere: the real `findQuickPlayBinding` lookup behind
 * `getQuickPlayChannelForGame`, the `discord_event_messages` insert/update
 * round-trip, and the D6 rehydration query (state filter + row order).
 *
 * The service is built by hand from the app's real collaborators with only the
 * Discord client and the room-card service stubbed, so a "restart" is simply a
 * second instance with an empty in-memory Map.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import { AdHocNotificationService } from './ad-hoc-notification.service';
import { ChannelBindingsService } from './channel-bindings.service';
import type { ChannelPresenceEmbedService } from './channel-presence-embed.service';
import { ChannelResolverService } from './channel-resolver.service';
import { DiscordEmbedFactory } from './discord-embed.factory';

const GUILD = 'rok1766-c2-guild';
const LOBBY_VOICE = 'rok1766-c2-lobby-voice';
const MONITOR_VOICE = 'rok1766-c2-monitor-voice';
const MONITOR_NOTIFY = 'rok1766-c2-monitor-notify';
const QP_TEXT = 'rok1766-c2-qp-text';
const dem = schema.discordEventMessages;

let testApp: TestApp;
const services: AdHocNotificationService[] = [];

function stubs() {
  let n = 0;
  return {
    client: {
      sendEmbed: jest.fn((channelId: string) =>
        Promise.resolve({ id: `msg-${++n}`, channelId }),
      ),
      editEmbed: jest.fn().mockResolvedValue(undefined),
      getGuildId: jest.fn().mockReturnValue(GUILD),
    },
    presence: { markDirty: jest.fn(), onEventEnded: jest.fn() },
  };
}
type Stubs = ReturnType<typeof stubs>;

/** A fresh service instance — a second one models a process restart. */
function buildService(s: Stubs): AdHocNotificationService {
  const app = testApp.app;
  const svc = new AdHocNotificationService(
    testApp.db,
    s.client as unknown as DiscordBotClientService,
    app.get(DiscordEmbedFactory),
    app.get(ChannelBindingsService),
    app.get(ChannelResolverService),
    s.presence as unknown as ChannelPresenceEmbedService,
    app.get(SettingsService),
  );
  services.push(svc);
  return svc;
}

/** Drive one batched flush without waiting on the 5s interval. */
const flush = (svc: AdHocNotificationService): Promise<void> =>
  (svc as unknown as { flushUpdates(): Promise<void> }).flushUpdates();

async function insertBinding(o: {
  channelId: string;
  channelType: 'text' | 'voice';
  bindingPurpose: string;
  gameId: number | null;
  config?: Record<string, unknown>;
}): Promise<string> {
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.channelBindings)
      .values({ guildId: GUILD, recurrenceGroupId: null, config: {}, ...o })
      .returning(),
    'binding',
  );
  return row.id;
}

const gameId = () => testApp.seed.game.id;
const bindQuickPlay = () =>
  insertBinding({
    channelId: QP_TEXT,
    channelType: 'text',
    bindingPurpose: 'quick-play-announcements',
    gameId: gameId(),
  });

/** A live ad-hoc event of the seeded game, with one active participant. */
async function insertLiveEvent(bindingId: string): Promise<number> {
  const now = new Date();
  const [event] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: 'Quick Play',
        creatorId: testApp.seed.adminUser.id,
        duration: [now, new Date(now.getTime() + 3_600_000)],
        gameId: gameId(),
        isAdHoc: true,
        adHocStatus: 'live',
        channelBindingId: bindingId,
      })
      .returning(),
    'event',
  );
  await testApp.db.insert(schema.adHocParticipants).values({
    eventId: event.id,
    discordUserId: 'rok1766-c2-user',
    discordUsername: 'Player1',
    sessionCount: 1,
  });
  return event.id;
}

const spawn = (svc: AdHocNotificationService, eventId: number, bid: string) =>
  svc.notifySpawn(
    eventId,
    bid,
    { id: eventId, title: 'Quick Play' },
    [{ discordUserId: 'rok1766-c2-user', discordUsername: 'Player1' }],
    gameId(),
  );

const complete = (
  svc: AdHocNotificationService,
  eventId: number,
  bid: string,
) =>
  svc.notifyCompleted(
    eventId,
    bid,
    { id: eventId, title: 'Quick Play', startTime: '', endTime: '' },
    [],
  );

const rowsFor = (eventId: number) =>
  testApp.db
    .select({
      channelId: dem.channelId,
      messageId: dem.messageId,
      embedState: dem.embedState,
    })
    .from(dem)
    .where(eq(dem.eventId, eventId));

const sentTo = (s: Stubs) => s.client.sendEmbed.mock.calls.map((c) => c[0]);
const editedIds = (s: Stubs) =>
  (s.client.editEmbed.mock.calls as string[][]).map((c) => `${c[0]}/${c[1]}`);

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  services.splice(0).forEach((svc) => svc.onModuleDestroy());
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('AdHocNotificationService — Quick Play Announcements (real DB)', () => {
  it('lobby spawn tracks ONE row in the QP channel and leaves the room card alone', async () => {
    const lobby = await insertBinding({
      channelId: LOBBY_VOICE,
      channelType: 'voice',
      bindingPurpose: 'general-lobby',
      gameId: null,
    });
    await bindQuickPlay();
    const eventId = await insertLiveEvent(lobby);
    const s = stubs();

    await spawn(buildService(s), eventId, lobby);

    expect(sentTo(s)).toEqual([QP_TEXT]);
    expect(await rowsFor(eventId)).toEqual([
      { channelId: QP_TEXT, messageId: 'msg-1', embedState: 'live' },
    ]);
    expect(s.presence.markDirty).toHaveBeenCalledWith(LOBBY_VOICE);
  });

  it('monitor spawn with a notification channel posts ONLY to the QP channel', async () => {
    const monitor = await insertBinding({
      channelId: MONITOR_VOICE,
      channelType: 'voice',
      bindingPurpose: 'game-voice-monitor',
      gameId: gameId(),
      config: { notificationChannelId: MONITOR_NOTIFY },
    });
    await bindQuickPlay();
    const eventId = await insertLiveEvent(monitor);
    const s = stubs();

    await spawn(buildService(s), eventId, monitor);

    expect(sentTo(s)).toEqual([QP_TEXT]);
    expect(await rowsFor(eventId)).toEqual([
      { channelId: QP_TEXT, messageId: 'msg-1', embedState: 'live' },
    ]);
    expect(s.presence.markDirty).not.toHaveBeenCalled();
  });

  it('completion edits the tracked card and flips its row to completed', async () => {
    const monitor = await insertBinding({
      channelId: MONITOR_VOICE,
      channelType: 'voice',
      bindingPurpose: 'game-voice-monitor',
      gameId: gameId(),
      config: { notificationChannelId: MONITOR_NOTIFY },
    });
    await bindQuickPlay();
    const eventId = await insertLiveEvent(monitor);
    const s = stubs();
    const svc = buildService(s);
    await spawn(svc, eventId, monitor);

    await complete(svc, eventId, monitor);

    expect(editedIds(s)).toEqual([`${QP_TEXT}/msg-1`]);
    expect(await rowsFor(eventId)).toEqual([
      { channelId: QP_TEXT, messageId: 'msg-1', embedState: 'completed' },
    ]);
  });

  it('after a restart an update edits the SAME message, not a later live unfurl row', async () => {
    const lobby = await insertBinding({
      channelId: LOBBY_VOICE,
      channelType: 'voice',
      bindingPurpose: 'general-lobby',
      gameId: null,
    });
    await bindQuickPlay();
    const eventId = await insertLiveEvent(lobby);
    const before = stubs();
    await spawn(buildService(before), eventId, lobby);
    // A link unfurl of the running session tracks its own LIVE row later.
    await testApp.db.insert(dem).values({
      eventId,
      guildId: GUILD,
      channelId: 'rok1766-c2-chat',
      messageId: 'unfurl-msg',
      embedState: 'live',
      createdAt: new Date(Date.now() + 60_000),
    });

    const after = stubs();
    const restarted = buildService(after);
    restarted.queueUpdate(eventId, lobby);
    await flush(restarted);

    expect(editedIds(after)).toEqual([`${QP_TEXT}/msg-1`]);
  });

  it('lobby event with NO QP binding: a restart never adopts its share/unfurl row (AC8)', async () => {
    const lobby = await insertBinding({
      channelId: LOBBY_VOICE,
      channelType: 'voice',
      bindingPurpose: 'general-lobby',
      gameId: null,
    });
    const eventId = await insertLiveEvent(lobby);
    await spawn(buildService(stubs()), eventId, lobby);
    await testApp.db.insert(dem).values({
      eventId,
      guildId: GUILD,
      channelId: 'rok1766-c2-share',
      messageId: 'share-msg',
      embedState: 'live',
    });

    const after = stubs();
    const restarted = buildService(after);
    restarted.queueUpdate(eventId, lobby);
    await flush(restarted);
    await complete(restarted, eventId, lobby);

    expect(editedIds(after)).toEqual([]);
    expect(await rowsFor(eventId)).toEqual([
      {
        channelId: 'rok1766-c2-share',
        messageId: 'share-msg',
        embedState: 'live',
      },
    ]);
  });

  it('a completed row is never rehydrated — a late update after a restart edits nothing', async () => {
    const lobby = await insertBinding({
      channelId: LOBBY_VOICE,
      channelType: 'voice',
      bindingPurpose: 'general-lobby',
      gameId: null,
    });
    await bindQuickPlay();
    const eventId = await insertLiveEvent(lobby);
    const first = stubs();
    const svc = buildService(first);
    await spawn(svc, eventId, lobby);
    await complete(svc, eventId, lobby);

    const after = stubs();
    const restarted = buildService(after);
    restarted.queueUpdate(eventId, lobby);
    await flush(restarted);

    expect(editedIds(after)).toEqual([]);
  });

  describe('cancel finalises the card (fix round 2, M1)', () => {
    const tracked = (svc: AdHocNotificationService, eventId: number) =>
      (svc as unknown as { messageIds: Map<number, unknown> }).messageIds.has(
        eventId,
      );

    it('cancelling a lobby QP session ends the QP card, completes its row, drops the Map entry', async () => {
      const lobby = await insertBinding({
        channelId: LOBBY_VOICE,
        channelType: 'voice',
        bindingPurpose: 'general-lobby',
        gameId: null,
      });
      await bindQuickPlay();
      const eventId = await insertLiveEvent(lobby);
      const s = stubs();
      const svc = buildService(s);
      await spawn(svc, eventId, lobby);

      await svc.notifyCancelled(eventId, lobby);

      expect(editedIds(s)).toEqual([`${QP_TEXT}/msg-1`]);
      expect(s.presence.onEventEnded).toHaveBeenCalledWith(lobby);
      expect(await rowsFor(eventId)).toEqual([
        { channelId: QP_TEXT, messageId: 'msg-1', embedState: 'completed' },
      ]);
      expect(tracked(svc, eventId)).toBe(false);
    });

    it('cancelling a monitor session after a restart ends its fallback-channel card (s2)', async () => {
      const monitor = await insertBinding({
        channelId: MONITOR_VOICE,
        channelType: 'voice',
        bindingPurpose: 'game-voice-monitor',
        gameId: gameId(),
        config: { notificationChannelId: MONITOR_NOTIFY },
      });
      const eventId = await insertLiveEvent(monitor);
      await spawn(buildService(stubs()), eventId, monitor);

      const after = stubs();
      const restarted = buildService(after);
      await restarted.notifyCancelled(eventId, monitor);

      expect(editedIds(after)).toEqual([`${MONITOR_NOTIFY}/msg-1`]);
      expect(await rowsFor(eventId)).toEqual([
        {
          channelId: MONITOR_NOTIFY,
          messageId: 'msg-1',
          embedState: 'completed',
        },
      ]);
      expect(tracked(restarted, eventId)).toBe(false);
    });
  });
});
