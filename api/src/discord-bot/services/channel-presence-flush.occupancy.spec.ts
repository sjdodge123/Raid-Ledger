/**
 * ROK-1499 — the flush's half of the room recap.
 *
 * Layer 1 does the arithmetic and the hydrate module does the reading; what is
 * only observable HERE is the wiring, and every one of these is a silent
 * failure rather than a crash:
 *
 * - a live flush that never reconciles leaves the ledger empty, so the recap
 *   says "No session started." for a room three people sat in all evening —
 *   the exact prod bug this story closes;
 * - a close that runs on EVERY empty flush restamps `left_at` each tick and
 *   collapses every stay to zero;
 * - hydrating against `now` instead of `empty_since` makes the span grow for
 *   the whole grace window, so the payload hash moves and the recap re-edits
 *   itself five seconds at a time (S-5).
 */
import { Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import type { ResolvedRoom } from './channel-presence-room.helpers';
import type { PresenceRow } from './channel-presence-store.helpers';
import type { RoomRecap } from './channel-presence-room-recap.helpers';

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
  deleteMessage: jest.fn(),
  isUnknownMessage: jest.fn(() => false),
}));
jest.mock('./ad-hoc-notification.helpers', () => ({
  __esModule: true,
  buildContext: jest.fn(),
  resolveNotificationChannel: jest.fn(),
}));
jest.mock('./channel-presence-store.helpers', () => ({
  __esModule: true,
  findOpenRow: jest.fn(),
  openRow: jest.fn(),
  markEmpty: jest.fn(),
  clearEmpty: jest.fn(),
  closeRow: jest.fn(),
  savePayloadHash: jest.fn(),
}));
jest.mock('./channel-presence-occupancy.helpers', () => ({
  __esModule: true,
  reconcileOccupancy: jest.fn(),
  closeAllOccupancy: jest.fn(),
}));
jest.mock('./channel-presence-room-recap.hydrate', () => ({
  __esModule: true,
  hydrateRoomRecap: jest.fn(),
}));
jest.mock('./channel-presence-flush.helpers', () => ({
  __esModule: true,
  ...jest.requireActual<typeof import('./channel-presence-flush.helpers')>(
    './channel-presence-flush.helpers',
  ),
  hydrateRecap: jest.fn(),
  renderLiveMessage: jest.fn(),
  renderRecapMessage: jest.fn(),
}));

import { flushChannel } from './channel-presence-flush';
import { findLinkedEvents, resolveRoom } from './channel-presence-room.helpers';
import {
  deleteMessage,
  editEmbeds,
  sendEmbeds,
} from '../discord-bot-client.messages.helpers';
import {
  buildContext,
  resolveNotificationChannel,
} from './ad-hoc-notification.helpers';
import {
  closeRow,
  findOpenRow,
  openRow,
} from './channel-presence-store.helpers';
import {
  closeAllOccupancy,
  reconcileOccupancy,
} from './channel-presence-occupancy.helpers';
import { hydrateRoomRecap } from './channel-presence-room-recap.hydrate';
import {
  hydrateRecap,
  renderLiveMessage,
  renderRecapMessage,
} from './channel-presence-flush.helpers';
import type { RecapInput } from './channel-presence-embed.recap.helpers';
import type { RoomMember } from './channel-presence-occupancy.helpers';

/**
 * Room members for the ledger. Names only — the `gameId` / `activityName`
 * columns are exercised explicitly by the tests that care about them.
 */
function present(names: Record<string, string>): Map<string, RoomMember> {
  return new Map(
    Object.entries(names).map(([id, displayName]) => [
      id,
      { displayName, gameId: null, activityName: null },
    ]),
  );
}
const m = {
  resolveRoom: jest.mocked(resolveRoom),
  findLinkedEvents: jest.mocked(findLinkedEvents),
  sendEmbeds: jest.mocked(sendEmbeds),
  buildContext: jest.mocked(buildContext),
  resolveNotificationChannel: jest.mocked(resolveNotificationChannel),
  findOpenRow: jest.mocked(findOpenRow),
  openRow: jest.mocked(openRow),
  reconcileOccupancy: jest.mocked(reconcileOccupancy),
  closeAllOccupancy: jest.mocked(closeAllOccupancy),
  hydrateRoomRecap: jest.mocked(hydrateRoomRecap),
  hydrateRecap: jest.mocked(hydrateRecap),
  renderLiveMessage: jest.mocked(renderLiveMessage),
  renderRecapMessage: jest.mocked(renderRecapMessage),
};

const GUILD = 'g-1';
const VOICE = 'vc-1';
const NOW = Date.parse('2026-09-13T20:00:00Z');
const OPENED_AT = new Date('2026-09-13T17:00:00Z');
const EMPTY_SINCE = new Date('2026-09-13T19:30:00Z');
const MEMBERS = present({ u1: 'Ada', u2: 'Bo' });

const RECAP: RoomRecap = {
  spanMs: 9_000_000,
  members: [{ displayName: 'Ada', seconds: 9000 }],
  activities: [{ name: 'Path of Exile 2', seconds: 9000 }],
};

const db = {} as PostgresJsDatabase<typeof schema>;

function room(over: Partial<ResolvedRoom> = {}): ResolvedRoom {
  return {
    channelId: VOICE,
    channelName: 'General',
    memberCount: 2,
    minPlayers: 3,
    groups: [],
    undetectedNames: ['Ada', 'Bo'],
    members: MEMBERS,
    channelResolved: true,
    ...over,
  };
}

function presenceRow(over: Partial<PresenceRow> = {}): PresenceRow {
  return {
    id: 'row-1',
    guildId: GUILD,
    voiceChannelId: VOICE,
    bindingId: 'b-1',
    textChannelId: 'tc-1',
    messageId: 'msg-1',
    status: 'open',
    payloadHash: null,
    openedAt: OPENED_AT,
    emptySince: null,
    closedAt: null,
    closeReason: null,
    createdAt: OPENED_AT,
    updatedAt: OPENED_AT,
    ...over,
  };
}

function flush(
  roomRecaps?: Map<string, { endedAt: number; recap: RoomRecap }>,
) {
  return {
    roomRecaps,
    deps: {
      db,
      clientService: {
        getClient: jest.fn(() => ({ guilds: { cache: new Map() } })),
        getGuildId: jest.fn(() => GUILD),
      },
    } as never,
    channelId: VOICE,
    guildId: GUILD,
    binding: {
      bindingId: 'b-1',
      channelId: VOICE,
      config: { minPlayers: 3, gracePeriod: 5 },
    } as never,
    logger: new Logger('spec'),
    now: NOW,
  };
}

/** A stand-in embed the real `payloadHashOf` can serialise. */
function embed(title: string): { toJSON: () => unknown } {
  return { toJSON: () => ({ title }) };
}

/** The `RecapInput` the flush handed the renderer. */
function recapInput(): RecapInput {
  expect(m.renderRecapMessage).toHaveBeenCalled();
  return m.renderRecapMessage.mock.calls[0][0];
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  m.buildContext.mockResolvedValue({
    communityName: 'c',
    clientUrl: 'u',
    timezone: 'UTC',
  });
  m.resolveNotificationChannel.mockResolvedValue('tc-1');
  m.resolveRoom.mockResolvedValue(room() as never);
  m.findLinkedEvents.mockResolvedValue([]);
  m.hydrateRecap.mockResolvedValue([]);
  m.hydrateRoomRecap.mockResolvedValue(RECAP);
  // `payloadHashOf` is the REAL helper here, and it serialises via `toJSON()`.
  m.renderLiveMessage.mockReturnValue([embed('live')] as never);
  m.renderRecapMessage.mockReturnValue([embed('recap')] as never);
  m.sendEmbeds.mockResolvedValue({ id: 'msg-1' } as never);
  m.openRow.mockResolvedValue({ row: presenceRow(), created: true });
});

describe('a live flush levels the occupancy ledger', () => {
  it('reconciles the room against the existing row, at the flush instant', async () => {
    m.findOpenRow.mockResolvedValue(presenceRow({ payloadHash: 'stale' }));

    await flushChannel(flush());

    expect(m.reconcileOccupancy).toHaveBeenCalledWith(
      db,
      'row-1',
      MEMBERS,
      new Date(NOW),
    );
  });

  it('reconciles the FIRST occupancy too, against the row it just opened', async () => {
    // Without this the opening flush records nobody, and a room that empties
    // one tick later recaps as if it had been deserted the whole time.
    m.findOpenRow.mockResolvedValue(null);
    m.openRow.mockResolvedValue({
      row: presenceRow({ id: 'row-new' }),
      created: true,
    });

    await flushChannel(flush());

    expect(m.reconcileOccupancy).toHaveBeenCalledWith(
      db,
      'row-new',
      MEMBERS,
      new Date(NOW),
    );
  });

  it('does not reconcile against a row another writer won', async () => {
    m.findOpenRow.mockResolvedValue(null);
    m.openRow.mockResolvedValue({ row: presenceRow(), created: false });

    await flushChannel(flush());

    expect(m.reconcileOccupancy).not.toHaveBeenCalled();
  });
});

describe('the empty-room ladder closes the ledger and recaps the room', () => {
  const empty = () => room({ memberCount: 0, members: new Map() });

  it('closes every open stay on the FIRST empty flush, at empty_since', async () => {
    m.resolveRoom.mockResolvedValue(empty() as never);
    m.findOpenRow.mockResolvedValue(presenceRow());

    await flushChannel(flush());

    expect(m.closeAllOccupancy).toHaveBeenCalledWith(
      db,
      'row-1',
      new Date(NOW),
    );
  });

  it('does NOT close again on a later empty flush', async () => {
    // `left_at` is already stamped; restamping it every tick would collapse
    // every stay in the room to zero seconds.
    m.resolveRoom.mockResolvedValue(empty() as never);
    m.findOpenRow.mockResolvedValue(presenceRow({ emptySince: EMPTY_SINCE }));

    await flushChannel(flush());

    expect(m.closeAllOccupancy).not.toHaveBeenCalled();
  });

  it('puts the hydrated room on the recap input', async () => {
    m.resolveRoom.mockResolvedValue(empty() as never);
    m.findOpenRow.mockResolvedValue(presenceRow());

    await flushChannel(flush());

    expect(recapInput().room).toBe(RECAP);
  });

  it('hydrates against empty_since, never now (S-5)', async () => {
    m.resolveRoom.mockResolvedValue(empty() as never);
    m.findOpenRow.mockResolvedValue(presenceRow({ emptySince: EMPTY_SINCE }));

    await flushChannel(flush());

    expect(m.hydrateRoomRecap).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ id: 'row-1' }),
      EMPTY_SINCE,
    );
  });
});

describe('the room summary is read once per empty transition (MAJOR 2)', () => {
  it('reuses the hydrated summary across the whole grace window', async () => {
    // Every tick of the grace re-renders (a session completing during it must
    // fold in), but the room summary is provably identical: the stays closed
    // at `empty_since` and the span ends there, so a session that closes
    // mid-grace clamps back to the same value. Re-deriving it cost two
    // unbounded reads per bound channel per five seconds.
    const memo = new Map<string, { endedAt: number; recap: RoomRecap }>();
    m.resolveRoom.mockResolvedValue(
      room({ memberCount: 0, members: new Map() }) as never,
    );
    // Inside the grace: the row is still open, so the memo survives the tick.
    // (It is dropped the moment `closeRow` retires the row — the row's history
    // is not a cache.)
    m.findOpenRow.mockResolvedValue(
      presenceRow({ emptySince: new Date(NOW - 60_000) }),
    );

    await flushChannel(flush(memo));
    await flushChannel(flush(memo));

    expect(m.hydrateRoomRecap).toHaveBeenCalledTimes(1);
    expect(m.renderRecapMessage).toHaveBeenCalledTimes(2);
    expect(recapInput().room).toBe(RECAP);
  });

  it('re-reads while the activity buffer may still be draining', async () => {
    // `GameActivityService` flushes its presence buffer on its own 30s timer,
    // so the FIRST empty flush can land before the evening's session rows
    // exist. Freezing that answer would keep a recap with missing games for
    // the whole grace window and every reaper render after it.
    const memo = new Map<string, { endedAt: number; recap: RoomRecap }>();
    m.resolveRoom.mockResolvedValue(
      room({ memberCount: 0, members: new Map() }) as never,
    );
    m.findOpenRow.mockResolvedValue(
      presenceRow({ emptySince: new Date(NOW - 10_000) }),
    );

    await flushChannel(flush(memo));
    await flushChannel(flush(memo));

    expect(m.hydrateRoomRecap).toHaveBeenCalledTimes(2);
  });

  it('re-reads once the span moves', async () => {
    const memo = new Map<string, { endedAt: number; recap: RoomRecap }>();
    m.resolveRoom.mockResolvedValue(
      room({ memberCount: 0, members: new Map() }) as never,
    );
    m.findOpenRow.mockResolvedValueOnce(presenceRow());
    m.findOpenRow.mockResolvedValueOnce(
      presenceRow({ emptySince: EMPTY_SINCE }),
    );

    await flushChannel(flush(memo));
    await flushChannel(flush(memo));

    expect(m.hydrateRoomRecap).toHaveBeenCalledTimes(2);
  });
});

describe('a room with no member map is a bug, not an empty room (MINOR 6)', () => {
  it('warns and writes nothing rather than closing every stay', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn');
    m.resolveRoom.mockResolvedValue(room({ members: undefined }) as never);
    m.findOpenRow.mockResolvedValue(presenceRow({ payloadHash: 'stale' }));

    await flushChannel(flush());

    expect(m.reconcileOccupancy).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('without a member map'),
    );
  });
});

describe('an unbound row still recaps its room', () => {
  it('hydrates the room it covered before closing', async () => {
    m.findOpenRow.mockResolvedValue(presenceRow({ emptySince: EMPTY_SINCE }));

    await flushChannel({ ...flush(), binding: null });

    expect(m.hydrateRoomRecap).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ id: 'row-1' }),
      EMPTY_SINCE,
    );
    expect(recapInput().room).toBe(RECAP);
  });

  it('omits the room when the binding vanished under a LIVE room (MINOR 3)', async () => {
    // No `empty_since` means there is no stable instant to span to. Falling
    // back to `now` would make the title's duration read the wall clock (S-5).
    m.findOpenRow.mockResolvedValue(presenceRow({ emptySince: null }));

    await flushChannel({ ...flush(), binding: null });

    expect(m.hydrateRoomRecap).not.toHaveBeenCalled();
    expect(recapInput().room).toBeNull();
  });
});

/**
 * ROK-1692 — a room that empties under two minutes after it opened, with no
 * game detected and no linked event, has its card DELETED instead of recapped.
 */
describe('a brief visit is deleted, not recapped (ROK-1692)', () => {
  const QUIET: RoomRecap = {
    spanMs: 8_000,
    members: [{ displayName: 'Pariah', seconds: 8 }],
    activities: [],
  };
  const openedAgo = (ms: number) =>
    m.findOpenRow.mockResolvedValue(
      presenceRow({ openedAt: new Date(NOW - ms), payloadHash: 'live' }),
    );

  beforeEach(() => {
    m.resolveRoom.mockResolvedValue(room({ memberCount: 0 }) as never);
    m.hydrateRoomRecap.mockResolvedValue(QUIET);
  });

  it('deletes the card and closes the row brief at empty_since, with no recap', async () => {
    openedAgo(8_000);

    await flushChannel(flush());

    expect(deleteMessage).toHaveBeenCalledWith(
      expect.anything(),
      'tc-1',
      'msg-1',
    );
    expect(closeRow).toHaveBeenCalledWith(db, 'row-1', 'brief', new Date(NOW));
    expect(m.renderRecapMessage).not.toHaveBeenCalled();
    expect(editEmbeds).not.toHaveBeenCalled();
  });

  it('still closes the row when the Discord delete fails', async () => {
    openedAgo(20_000);
    jest
      .mocked(deleteMessage)
      .mockRejectedValueOnce(new Error('Missing Permissions'));

    await expect(flushChannel(flush())).resolves.toBeUndefined();

    expect(closeRow).toHaveBeenCalledWith(db, 'row-1', 'brief', new Date(NOW));
  });
});

describe('a visit that is not brief recaps exactly as before (ROK-1692)', () => {
  const QUIET: RoomRecap = {
    spanMs: 8_000,
    members: [{ displayName: 'Pariah', seconds: 8 }],
    activities: [],
  };
  const openedAgo = (ms: number) =>
    m.findOpenRow.mockResolvedValue(
      presenceRow({ openedAt: new Date(NOW - ms), payloadHash: 'live' }),
    );

  beforeEach(() => {
    m.resolveRoom.mockResolvedValue(room({ memberCount: 0 }) as never);
    m.hydrateRoomRecap.mockResolvedValue(QUIET);
  });

  it('recaps as before once the visit reaches two minutes', async () => {
    openedAgo(120_000);

    await flushChannel(flush());

    expect(deleteMessage).not.toHaveBeenCalled();
    expect(recapInput().room).toBe(QUIET);
    expect(editEmbeds).toHaveBeenCalledTimes(1);
  });

  it('recaps a short visit when a game was detected', async () => {
    openedAgo(20_000);
    m.hydrateRoomRecap.mockResolvedValue({
      ...QUIET,
      activities: [{ name: 'Valheim', seconds: 20 }],
    });

    await flushChannel(flush());

    expect(deleteMessage).not.toHaveBeenCalled();
    expect(editEmbeds).toHaveBeenCalledTimes(1);
  });

  it('recaps a short visit when an event is linked to the room', async () => {
    openedAgo(20_000);
    m.hydrateRecap.mockResolvedValue([{ id: 900 }] as never);

    await flushChannel(flush());

    expect(deleteMessage).not.toHaveBeenCalled();
    expect(editEmbeds).toHaveBeenCalledTimes(1);
  });

  it('recaps a short visit while a linked session is still live', async () => {
    openedAgo(20_000);
    m.findLinkedEvents.mockResolvedValue([
      { id: 901, gameId: 7, adHocStatus: 'live' },
    ]);

    await flushChannel(flush());

    expect(deleteMessage).not.toHaveBeenCalled();
    expect(closeRow).not.toHaveBeenCalledWith(
      db,
      'row-1',
      'brief',
      expect.anything(),
    );
  });
});
