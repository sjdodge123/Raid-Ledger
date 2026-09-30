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
import {
  mocked,
  VOICE,
  TEXT,
  MESSAGE,
  BINDING,
  NOW,
  room,
  presenceRow,
  ready,
  installPresenceHooks,
} from './channel-presence-embed.service.spec-helpers';

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
  // NOT a jest.fn(): the 10008 branch is only meaningful if the real predicate
  // decides it. A stub would let the branch pass on any error at all.
  isUnknownMessage: jest.requireActual<
    typeof import('../discord-bot-client.messages.helpers')
  >('../discord-bot-client.messages.helpers').isUnknownMessage,
}));
jest.mock('./ad-hoc-notification.helpers', () => ({
  __esModule: true,
  buildContext: jest.fn(),
  resolveNotificationChannel: jest.fn(),
  buildEmbedEventData: jest.fn(),
}));
// ROK-1499: the occupancy ledger and the room hydration are pinned by their
// own specs. Here they would only pull `fakeDb()` (which knows one SELECT) into
// insert/update shapes this suite says nothing about.
jest.mock('./channel-presence-occupancy.helpers', () => ({
  __esModule: true,
  reconcileOccupancy: jest.fn(),
  closeAllOccupancy: jest.fn(),
}));
jest.mock('./channel-presence-room-recap.hydrate', () => ({
  __esModule: true,
  hydrateRoomRecap: jest.fn(() => Promise.resolve(EMPTY_ROOM)),
}));
const EMPTY_ROOM = { spanMs: 0, members: [], activities: [] };
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

installPresenceHooks();

describe('ChannelPresenceEmbedService — D8 empty → recap → close', () => {
  const empty = (): ReturnType<typeof room> =>
    room({ memberCount: 0, groups: [] });

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
      expect.any(Date),
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
      expect.any(Date),
    );
  });
});

describe('ChannelPresenceEmbedService — D8 rejoin inside the grace, and the event-ended recap', () => {
  const empty = (): ReturnType<typeof room> =>
    room({ memberCount: 0, groups: [] });

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
});

describe('ChannelPresenceEmbedService — D8 rejoin after the grace (ROK-1498)', () => {
  it('posts a NEW message — and closes the old row stale — when someone joins after the grace elapsed on a row nothing closed (ROK-1498)', async () => {
    const { service } = await ready();
    mocked.findOpenRow.mockResolvedValue(
      presenceRow({ emptySince: new Date(NOW - 10 * 60 * 60_000) }),
    );

    service.markDirty(VOICE);
    await service.flushNow();

    expect(mocked.closeRow).toHaveBeenCalledWith(
      expect.anything(),
      'row-1',
      'stale',
      expect.any(Date),
    );
    expect(mocked.sendEmbeds).toHaveBeenCalledTimes(1);
    expect(mocked.sendEmbeds.mock.calls[0][1]).toBe(TEXT);
    expect(mocked.editEmbeds).not.toHaveBeenCalled();
    expect(mocked.clearEmpty).not.toHaveBeenCalled();
    expect(mocked.openRow).toHaveBeenCalledTimes(1);
    const embeds = mocked.sendEmbeds.mock.calls[0][2];
    expect(embeds[0].data.title).not.toContain('session ended');
  });

  it('does not resurrect a stale row even while a linked session is still live/grace_period (ROK-1498)', async () => {
    const { service } = await ready();
    mocked.findOpenRow.mockResolvedValue(
      presenceRow({ emptySince: new Date(NOW - 10 * 60 * 60_000) }),
    );
    mocked.findLinkedEvents.mockResolvedValue([
      { id: 900, gameId: 7, adHocStatus: 'grace_period' },
    ]);

    service.markDirty(VOICE);
    await service.flushNow();

    expect(mocked.closeRow).toHaveBeenCalledWith(
      expect.anything(),
      'row-1',
      'stale',
      expect.any(Date),
    );
    expect(mocked.sendEmbeds).toHaveBeenCalledTimes(1);
    expect(mocked.editEmbeds).not.toHaveBeenCalled();
  });

  it('treats the exact grace boundary as expired, matching isCloseDue (ROK-1498)', async () => {
    const { service } = await ready();
    mocked.findOpenRow.mockResolvedValue(
      presenceRow({ emptySince: new Date(NOW - 5 * 60_000) }),
    );

    service.markDirty(VOICE);
    await service.flushNow();

    expect(mocked.closeRow).toHaveBeenCalledWith(
      expect.anything(),
      'row-1',
      'stale',
      expect.any(Date),
    );
    expect(mocked.sendEmbeds).toHaveBeenCalledTimes(1);
    expect(mocked.editEmbeds).not.toHaveBeenCalled();
  });
});
