/**
 * ROK-1446 (Lane A) — the flush loop, restart adoption and the close ladder.
 *
 * What is mocked here is only the BOUNDARY: Discord transport, the store's
 * SQL, and `resolveRoom`. The render itself — `buildChannelPresenceEmbeds`,
 * `buildRecapEmbeds`, `applyBudget` — runs for real, deliberately, because the
 * D5 dirty check hashes the rendered payload. Mocking the render would make
 * "an unchanged payload issues no edit" pass against a constant, which is
 * exactly the could-never-have-failed shape this story keeps finding.
 *
 * Every assertion below was verified by mutating the finished implementation;
 * the mutation table is in `handover-ROK-1446-laneA-service.md`.
 */
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  ChannelPresenceEmbedService,
  PRESENCE_FLUSH_INTERVAL_MS,
} from './channel-presence-embed.service';
import type { EmbedContext, EmbedEventData } from './discord-embed.factory';
import type { ResolvedRoom, RoomGroup } from './channel-presence-room.helpers';
import type { PresenceRow } from './channel-presence-store.helpers';

jest.mock('./channel-presence-room.helpers', () => ({
  __esModule: true,
  resolveRoom: jest.fn(),
  findLinkedEvents: jest.fn(),
  recapEvents: jest.fn(),
}));
jest.mock('../discord-bot-client.messages.helpers', () => ({
  __esModule: true,
  sendEmbeds: jest.fn(),
  editEmbeds: jest.fn(),
  fetchMessageOrNull: jest.fn(),
}));
jest.mock('./ad-hoc-notification.helpers', () => ({
  __esModule: true,
  buildContext: jest.fn(),
  resolveNotificationChannel: jest.fn(),
  buildEmbedEventData: jest.fn(),
}));
jest.mock('./channel-presence-store.helpers', () => ({
  __esModule: true,
  findOpenRow: jest.fn(),
  openRow: jest.fn(),
  markEmpty: jest.fn(),
  clearEmpty: jest.fn(),
  closeRow: jest.fn(),
  savePayloadHash: jest.fn(),
  listOpenRows: jest.fn(),
}));

import {
  findLinkedEvents,
  recapEvents,
  resolveRoom,
} from './channel-presence-room.helpers';
import {
  editEmbeds,
  fetchMessageOrNull,
  sendEmbeds,
} from '../discord-bot-client.messages.helpers';
import {
  buildContext,
  buildEmbedEventData,
  resolveNotificationChannel,
} from './ad-hoc-notification.helpers';
import {
  clearEmpty,
  closeRow,
  findOpenRow,
  listOpenRows,
  markEmpty,
  openRow,
  savePayloadHash,
} from './channel-presence-store.helpers';

const mocked = {
  resolveRoom: jest.mocked(resolveRoom),
  findLinkedEvents: jest.mocked(findLinkedEvents),
  recapEvents: jest.mocked(recapEvents),
  sendEmbeds: jest.mocked(sendEmbeds),
  editEmbeds: jest.mocked(editEmbeds),
  fetchMessageOrNull: jest.mocked(fetchMessageOrNull),
  buildContext: jest.mocked(buildContext),
  resolveNotificationChannel: jest.mocked(resolveNotificationChannel),
  buildEmbedEventData: jest.mocked(buildEmbedEventData),
  findOpenRow: jest.mocked(findOpenRow),
  openRow: jest.mocked(openRow),
  markEmpty: jest.mocked(markEmpty),
  clearEmpty: jest.mocked(clearEmpty),
  closeRow: jest.mocked(closeRow),
  savePayloadHash: jest.mocked(savePayloadHash),
  listOpenRows: jest.mocked(listOpenRows),
};

const GUILD = 'g-1';
const VOICE = 'vc-1';
const TEXT = 'tc-1';
const MESSAGE = 'msg-1';
const BINDING = 'b-1';
const NOW = Date.parse('2026-09-02T18:00:00Z');
const OPENED_AT = new Date('2026-09-02T17:30:00Z');

const CONTEXT: EmbedContext = {
  communityName: 'Gamer Saloon',
  clientUrl: 'https://rl.example',
  timezone: 'UTC',
};

/** A group below `minPlayers` with no event — the amber render. */
function short(gameName: string, names: string[]): RoomGroup {
  return {
    gameId: 7,
    gameName,
    memberIds: names.map((n) => `u-${n}`),
    memberNames: names,
    qualifying: false,
    eventId: null,
    eventData: null,
    game: null,
  };
}

function room(overrides: Partial<ResolvedRoom> = {}): ResolvedRoom {
  return {
    channelId: VOICE,
    channelName: 'General',
    memberCount: 2,
    minPlayers: 3,
    groups: [short('Valheim', ['ana', 'bo'])],
    undetectedNames: [],
    ...overrides,
  };
}

function presenceRow(overrides: Partial<PresenceRow> = {}): PresenceRow {
  return {
    id: 'row-1',
    guildId: GUILD,
    voiceChannelId: VOICE,
    bindingId: BINDING,
    textChannelId: TEXT,
    messageId: MESSAGE,
    status: 'open',
    payloadHash: null,
    openedAt: OPENED_AT,
    emptySince: null,
    closedAt: null,
    closeReason: null,
    createdAt: OPENED_AT,
    updatedAt: OPENED_AT,
    ...overrides,
  } as PresenceRow;
}

function eventData(id: number): EmbedEventData {
  return {
    id,
    title: 'Valheim — Quick Play',
    startTime: '2026-09-02T17:00:00Z',
    endTime: '2026-09-02T19:00:00Z',
    signupCount: 2,
    signupMentions: [
      {
        displayName: 'ana',
        role: null,
        preferredRoles: null,
        status: 'confirmed',
      },
      {
        displayName: 'bo',
        role: null,
        preferredRoles: null,
        status: 'confirmed',
      },
    ],
    game: { id: 7, name: 'Valheim' },
  } as EmbedEventData;
}

/** Only the two calls the flush actually issues against the DB directly. */
function fakeDb(): PostgresJsDatabase<typeof schema> {
  return {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
  } as unknown as PostgresJsDatabase<typeof schema>;
}

interface Harness {
  service: ChannelPresenceEmbedService;
  getBindingById: jest.Mock;
  getBindingsWithGameNames: jest.Mock;
}

function lobbyBindingRecord(): Record<string, unknown> {
  return {
    id: BINDING,
    channelId: VOICE,
    gameId: null,
    gameName: null,
    bindingPurpose: 'general-lobby',
    recurrenceGroupId: null,
    config: { minPlayers: 3, gracePeriod: 5 },
  };
}

function build(
  bindings: Record<string, unknown>[] = [lobbyBindingRecord()],
): Harness {
  const getBindingsWithGameNames = jest.fn().mockResolvedValue(bindings);
  const getBindingById = jest.fn().mockResolvedValue(bindings[0] ?? null);
  const clientService = {
    getClient: jest.fn().mockReturnValue({}),
    getGuildId: jest.fn().mockReturnValue(GUILD),
  };
  const service = new ChannelPresenceEmbedService(
    fakeDb(),
    clientService as never,
    {} as never,
    { getBindingsWithGameNames, getBindingById } as never,
    {} as never,
    {} as never,
    { executeWithTracking: jest.fn() } as never,
  );
  return { service, getBindingById, getBindingsWithGameNames };
}

/** A service that has already adopted its open rows, so flushes may post. */
async function ready(bindings?: Record<string, unknown>[]): Promise<Harness> {
  const harness = build(bindings);
  mocked.listOpenRows.mockResolvedValue([]);
  await harness.service.recover();
  return harness;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  mocked.buildContext.mockResolvedValue(CONTEXT);
  mocked.resolveNotificationChannel.mockResolvedValue(TEXT);
  mocked.resolveRoom.mockResolvedValue(room());
  mocked.findLinkedEvents.mockResolvedValue([]);
  mocked.recapEvents.mockResolvedValue([]);
  mocked.listOpenRows.mockResolvedValue([]);
  mocked.findOpenRow.mockResolvedValue(null);
  mocked.buildEmbedEventData.mockResolvedValue(eventData(900));
  mocked.sendEmbeds.mockResolvedValue({ id: MESSAGE } as never);
  mocked.editEmbeds.mockResolvedValue({ id: MESSAGE } as never);
  mocked.openRow.mockImplementation((_db, input) =>
    Promise.resolve({
      row: presenceRow({ messageId: input.messageId }),
      created: true,
    }),
  );
});

afterEach(() => {
  jest.useRealTimers();
});

describe('ChannelPresenceEmbedService — D5 flush loop', () => {
  it('shares the 5s cadence the per-event cards drain on', () => {
    expect(PRESENCE_FLUSH_INTERVAL_MS).toBe(5000);
  });

  it('posts one message on the first occupancy of a room with no open row', async () => {
    const { service } = await ready();
    service.onModuleInit();
    service.markDirty(VOICE);

    await jest.advanceTimersByTimeAsync(PRESENCE_FLUSH_INTERVAL_MS);

    expect(mocked.sendEmbeds).toHaveBeenCalledTimes(1);
    const [, channelId, embeds] = mocked.sendEmbeds.mock.calls[0];
    expect(channelId).toBe(TEXT);
    expect(embeds).toHaveLength(2);
    expect(mocked.openRow).toHaveBeenCalledTimes(1);
    expect(mocked.savePayloadHash).toHaveBeenCalledTimes(1);
    service.onModuleDestroy();
  });

  it('collapses 20 markDirty calls inside one interval into exactly one edit', async () => {
    const { service } = await ready();
    mocked.findOpenRow.mockResolvedValue(presenceRow());
    service.onModuleInit();
    for (let i = 0; i < 20; i += 1) service.markDirty(VOICE);

    await jest.advanceTimersByTimeAsync(PRESENCE_FLUSH_INTERVAL_MS);

    expect(mocked.editEmbeds).toHaveBeenCalledTimes(1);
    expect(mocked.sendEmbeds).not.toHaveBeenCalled();
    service.onModuleDestroy();
  });

  it('issues NO edit at all when the rendered payload is unchanged', async () => {
    const { service } = await ready();
    const row = presenceRow();
    mocked.findOpenRow.mockResolvedValue(row);
    service.markDirty(VOICE);
    await service.flushNow();
    expect(mocked.editEmbeds).toHaveBeenCalledTimes(1);

    // Feed back the hash the first edit stored, exactly as the DB would.
    const stored = mocked.savePayloadHash.mock.calls[0][2];
    mocked.findOpenRow.mockResolvedValue(presenceRow({ payloadHash: stored }));
    service.markDirty(VOICE);
    await service.flushNow();

    expect(mocked.editEmbeds).toHaveBeenCalledTimes(1);
  });

  it('DOES edit when the same room resolves to a different roster', async () => {
    const { service } = await ready();
    mocked.findOpenRow.mockResolvedValue(presenceRow());
    service.markDirty(VOICE);
    await service.flushNow();
    const stored = mocked.savePayloadHash.mock.calls[0][2];

    mocked.findOpenRow.mockResolvedValue(presenceRow({ payloadHash: stored }));
    mocked.resolveRoom.mockResolvedValue(
      room({ memberCount: 3, groups: [short('Valheim', ['ana', 'bo', 'cy'])] }),
    );
    service.markDirty(VOICE);
    await service.flushNow();

    expect(mocked.editEmbeds).toHaveBeenCalledTimes(2);
    expect(mocked.savePayloadHash.mock.calls[1][2]).not.toBe(stored);
  });

  it('keeps the tick alive when one channel throws', async () => {
    const { service } = await ready();
    mocked.findOpenRow.mockResolvedValue(presenceRow());
    mocked.editEmbeds
      .mockRejectedValueOnce(new Error('discord exploded'))
      .mockResolvedValue({ id: MESSAGE } as never);
    service.markDirty('vc-broken');
    service.markDirty(VOICE);

    await service.flushNow();

    expect(mocked.editEmbeds).toHaveBeenCalledTimes(2);
  });

  it('never posts before recover() has adopted the open rows', async () => {
    const { service } = build();
    service.onModuleInit();
    service.markDirty(VOICE);

    await jest.advanceTimersByTimeAsync(PRESENCE_FLUSH_INTERVAL_MS * 3);
    expect(mocked.sendEmbeds).not.toHaveBeenCalled();

    await service.recover();
    await jest.advanceTimersByTimeAsync(PRESENCE_FLUSH_INTERVAL_MS);
    expect(mocked.sendEmbeds).toHaveBeenCalledTimes(1);
    service.onModuleDestroy();
  });
});

describe('ChannelPresenceEmbedService — D7 restart re-adoption', () => {
  it('adopts a row whose message Discord still has, and edits it', async () => {
    const { service } = build();
    const row = presenceRow();
    mocked.listOpenRows.mockResolvedValue([row]);
    mocked.fetchMessageOrNull.mockResolvedValue({ id: MESSAGE } as never);
    mocked.findOpenRow.mockResolvedValue(row);

    await service.recover();
    await service.flushNow();

    expect(mocked.closeRow).not.toHaveBeenCalled();
    expect(mocked.sendEmbeds).not.toHaveBeenCalled();
    expect(mocked.editEmbeds).toHaveBeenCalledTimes(1);
    expect(mocked.editEmbeds.mock.calls[0][2]).toBe(MESSAGE);
  });

  it("closes a row whose message is gone (10008) with close_reason 'missing'", async () => {
    const { service } = build();
    mocked.listOpenRows.mockResolvedValue([presenceRow()]);
    mocked.fetchMessageOrNull.mockResolvedValue(null);

    await service.recover();
    await service.flushNow();

    expect(mocked.closeRow).toHaveBeenCalledWith(
      expect.anything(),
      'row-1',
      'missing',
    );
    expect(mocked.editEmbeds).not.toHaveBeenCalled();
  });

  it('is idempotent — a second recover posts no second message', async () => {
    const { service } = build();
    const row = presenceRow();
    mocked.listOpenRows.mockResolvedValue([row]);
    mocked.fetchMessageOrNull.mockResolvedValue({ id: MESSAGE } as never);
    mocked.findOpenRow.mockResolvedValue(row);

    await service.recover();
    await service.recover();
    await service.flushNow();

    expect(mocked.sendEmbeds).not.toHaveBeenCalled();
    expect(mocked.openRow).not.toHaveBeenCalled();
    expect(mocked.editEmbeds).toHaveBeenCalledTimes(1);
  });

  it('reaps stale rows through the same flush ladder', async () => {
    const { service } = await ready();
    const row = presenceRow();
    mocked.listOpenRows.mockResolvedValue([row]);
    mocked.findOpenRow.mockResolvedValue(row);

    await service.reapStaleRows();

    expect(mocked.editEmbeds).toHaveBeenCalledTimes(1);
  });
});

describe('ChannelPresenceEmbedService — D8 empty → recap → close', () => {
  const empty = (): ResolvedRoom => room({ memberCount: 0, groups: [] });

  it('stamps empty_since and renders the recap without closing inside the grace', async () => {
    const { service } = await ready();
    mocked.resolveRoom.mockResolvedValue(empty());
    mocked.findOpenRow.mockResolvedValue(presenceRow());

    service.markDirty(VOICE);
    await service.flushNow();

    expect(mocked.markEmpty).toHaveBeenCalledTimes(1);
    expect(mocked.editEmbeds).toHaveBeenCalledTimes(1);
    const embeds = mocked.editEmbeds.mock.calls[0][3];
    expect(embeds[0].data.title).toContain('session ended');
    expect(mocked.closeRow).not.toHaveBeenCalled();
  });

  it('closes once the binding grace has elapsed and no session is live', async () => {
    const { service } = await ready();
    mocked.resolveRoom.mockResolvedValue(empty());
    mocked.findOpenRow.mockResolvedValue(
      presenceRow({ emptySince: new Date(NOW - 5 * 60_000) }),
    );

    service.markDirty(VOICE);
    await service.flushNow();

    expect(mocked.closeRow).toHaveBeenCalledWith(
      expect.anything(),
      'row-1',
      'empty',
    );
  });

  it('keeps the message open past the grace while a session is still live', async () => {
    const { service } = await ready();
    mocked.resolveRoom.mockResolvedValue(empty());
    mocked.findOpenRow.mockResolvedValue(
      presenceRow({ emptySince: new Date(NOW - 60 * 60_000) }),
    );
    mocked.findLinkedEvents.mockResolvedValue([
      { id: 900, gameId: 7, adHocStatus: 'grace_period' },
    ]);

    service.markDirty(VOICE);
    await service.flushNow();

    expect(mocked.closeRow).not.toHaveBeenCalled();
  });

  it('flips the SAME message back to live when someone rejoins in the grace', async () => {
    const { service } = await ready();
    mocked.findOpenRow.mockResolvedValue(
      presenceRow({ emptySince: new Date(NOW - 60_000) }),
    );

    service.markDirty(VOICE);
    await service.flushNow();

    expect(mocked.clearEmpty).toHaveBeenCalledWith(expect.anything(), 'row-1');
    expect(mocked.sendEmbeds).not.toHaveBeenCalled();
    expect(mocked.editEmbeds).toHaveBeenCalledTimes(1);
    expect(mocked.editEmbeds.mock.calls[0][2]).toBe(MESSAGE);
    const embeds = mocked.editEmbeds.mock.calls[0][3];
    expect(embeds[0].data.title).not.toContain('session ended');
  });

  it('re-renders the recap when onEventEnded fires for the binding', async () => {
    const { service, getBindingById } = await ready();
    mocked.resolveRoom.mockResolvedValue(empty());
    mocked.findOpenRow.mockResolvedValue(presenceRow());
    mocked.recapEvents.mockResolvedValue([
      { id: 900, gameId: 7, adHocStatus: 'ended' },
    ]);

    service.onEventEnded(BINDING);
    await service.flushNow();

    expect(getBindingById).toHaveBeenCalledWith(BINDING);
    expect(mocked.editEmbeds).toHaveBeenCalledTimes(1);
    const embeds = mocked.editEmbeds.mock.calls[0][3];
    expect(embeds).toHaveLength(2);
    expect(embeds[1].data.author?.name).toContain('ENDED');
  });

  it('recaps and closes a row whose binding has been deleted', async () => {
    const { service } = await ready([]);
    mocked.findOpenRow.mockResolvedValue(presenceRow());

    service.markDirty(VOICE);
    await service.flushNow();

    expect(mocked.resolveRoom).not.toHaveBeenCalled();
    expect(mocked.editEmbeds).toHaveBeenCalledTimes(1);
    expect(mocked.closeRow).toHaveBeenCalledWith(
      expect.anything(),
      'row-1',
      'unbound',
    );
  });
});
