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
import { PRESENCE_FLUSH_INTERVAL_MS } from './channel-presence-embed.service';
import {
  mocked,
  VOICE,
  TEXT,
  MESSAGE,
  BINDING,
  NOW,
  OPENED_AT,
  unknownMessage,
  short,
  room,
  presenceRow,
  loggerErrors,
  loggerWarnings,
  build,
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
});

describe('ChannelPresenceEmbedService — D5 flush loop: re-render and resilience', () => {
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

    // `resolves` rather than a bare await: if the per-channel catch is removed
    // the tick rejects, and this fails with an assertion naming that rejection
    // instead of an uncaught throw that proves nothing.
    await expect(service.flushNow()).resolves.toBeUndefined();

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

/**
 * The failure paths the Lane 1 review found: every one of them is a case where
 * a TRANSIENT fault (a Discord 5xx, a cold channel cache, a DB blip) produced a
 * PERMANENT or destructive outcome. Each assertion below was proved by mutating
 * the finished implementation — see `handover-ROK-1446-fix-service2.md`.
 */
describe('ChannelPresenceEmbedService — transient faults stay transient', () => {
  it('still becomes ready, and still flushes, when listOpenRows rejects (S-3)', async () => {
    const { service } = build();
    mocked.listOpenRows.mockRejectedValue(new Error('pool exhausted'));

    // `resolves` on purpose: with the try/finally removed the rejection escapes
    // `recover()`, and this fails naming that rejection rather than dying as an
    // uncaught throw that would prove nothing.
    await expect(service.recover()).resolves.toBeUndefined();

    service.markDirty(VOICE);
    await service.flushNow();

    // `ready` is the real subject — nothing else in the class ever sets it, so
    // a `false` here is permanent for the life of the process.
    expect(mocked.sendEmbeds).toHaveBeenCalledTimes(1);
  });
});

describe('ChannelPresenceEmbedService — a failed flush is re-queued, but not forever', () => {
  it('retries on the next tick a channel whose first flush threw (S-1)', async () => {
    const { service } = await ready();
    mocked.sendEmbeds
      .mockRejectedValueOnce(new Error('discord 500'))
      .mockResolvedValue({ id: MESSAGE } as never);
    service.onModuleInit();
    service.markDirty(VOICE);

    await jest.advanceTimersByTimeAsync(PRESENCE_FLUSH_INTERVAL_MS);
    expect(mocked.sendEmbeds).toHaveBeenCalledTimes(1);

    // No row was ever written, so the 5-minute reaper (which iterates
    // `listOpenRows`) cannot recover this room. The dirty set is the only
    // memory that it needs a message at all.
    await jest.advanceTimersByTimeAsync(PRESENCE_FLUSH_INTERVAL_MS);

    expect(mocked.sendEmbeds).toHaveBeenCalledTimes(2);
    service.onModuleDestroy();
  });

  it('drops a permanently failing channel once the retry budget runs out (S-1)', async () => {
    const { service } = await ready();
    mocked.sendEmbeds.mockRejectedValue(new Error('discord is down'));
    service.onModuleInit();
    service.markDirty(VOICE);

    await jest.advanceTimersByTimeAsync(PRESENCE_FLUSH_INTERVAL_MS * 8);

    // 1 first attempt + MAX_FLUSH_RETRIES (3) re-queued attempts, then dropped.
    // Without the budget this spins the broken channel every 5 s forever.
    expect(mocked.sendEmbeds).toHaveBeenCalledTimes(4);
    service.onModuleDestroy();
  });
});

describe("ChannelPresenceEmbedService — the loop's own error paths", () => {
  it('makes flushNow wait for a tick already in flight instead of no-opping (S-6)', async () => {
    const { service } = await ready();
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    mocked.sendEmbeds.mockImplementationOnce(async () => {
      entered();
      await gate;
      return { id: MESSAGE } as never;
    });

    service.markDirty(VOICE);
    const first = service.flushNow();
    // Wait until tick 1 is PAST its `dirty.clear()` and parked in the
    // transport. Marking dirty before that point is a different (and much
    // weaker) test: the first tick would simply pick the channel up itself.
    await started;
    service.markDirty(VOICE);
    const second = service.flushNow();

    release();
    await Promise.all([first, second]);

    // The D12 seam does setRoomOverride -> flushNow -> readOpenRow. If the
    // second call inherits the `flushing` early return it answers HTTP 200
    // having rendered nothing, and AC9's smoke reads a null messageId.
    expect(mocked.sendEmbeds).toHaveBeenCalledTimes(2);
  });

  it("catches a rejection out of the interval's void-ed drain (S-4)", async () => {
    const { service, clientService } = await ready();
    const errors = loggerErrors(service);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    clientService.getGuildId.mockImplementation(() => {
      throw new Error('client torn down mid-tick');
    });

    service.onModuleInit();
    service.markDirty(VOICE);
    await jest.advanceTimersByTimeAsync(PRESENCE_FLUSH_INTERVAL_MS);
    service.onModuleDestroy();

    // Node only emits `unhandledRejection` at a real microtask checkpoint,
    // which fake timers never reach on their own.
    jest.useRealTimers();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off('unhandledRejection', onUnhandled);

    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining('Presence drain failed'),
    );
    // An unguarded rejection out of `void this.drain()` terminates the API
    // process on Node's default.
    expect(unhandled).toEqual([]);
  });
});

describe('ChannelPresenceEmbedService — an unresolvable channel is not an empty room', () => {
  it('skips the flush entirely when the voice channel did not resolve (S-2)', async () => {
    const { service } = await ready();
    mocked.resolveRoom.mockResolvedValue(
      room({
        memberCount: 0,
        groups: [],
        channelName: null,
        channelResolved: false,
      }),
    );
    mocked.findOpenRow.mockResolvedValue(presenceRow());

    service.markDirty(VOICE);
    await service.flushNow();

    // A cold `guild.channels.cache` looks EXACTLY like an empty room. Reacting
    // to it stamps `empty_since` and rewrites a live session's message into
    // "Unknown channel - session ended", then closes the row for good.
    expect(mocked.markEmpty).not.toHaveBeenCalled();
    expect(mocked.editEmbeds).not.toHaveBeenCalled();
    expect(mocked.closeRow).not.toHaveBeenCalled();
  });
});

describe('ChannelPresenceEmbedService — the recap is stable and truthful', () => {
  it('reports a still-live session as ending when the room emptied, not at "now" (S-5)', async () => {
    const { service } = await ready();
    mocked.resolveRoom.mockResolvedValue(room({ memberCount: 0, groups: [] }));
    const emptySince = new Date(NOW - 60_000);
    mocked.findOpenRow.mockResolvedValue(presenceRow({ emptySince }));
    mocked.recapEvents.mockResolvedValue([
      { id: 900, gameId: 7, adHocStatus: 'live' },
    ]);

    service.markDirty(VOICE);
    await service.flushNow();
    expect(mocked.editEmbeds).toHaveBeenCalledTimes(1);
    const stored = mocked.savePayloadHash.mock.calls[0][2];

    // 90 s later: same empty room, same still-live session. Clamped to
    // `empty_since` the payload is byte-identical, so D5's dirty check issues
    // NO second edit. Clamped to `now` the recap edits Discord forever and the
    // "session ended at" the reader sees creeps minute by minute.
    mocked.findOpenRow.mockResolvedValue(
      presenceRow({ emptySince, payloadHash: stored }),
    );
    jest.setSystemTime(NOW + 90_000);
    service.markDirty(VOICE);
    await service.flushNow();

    expect(mocked.editEmbeds).toHaveBeenCalledTimes(1);
  });

  it('keeps the last good render when an unbound row has no recoverable history (S-7)', async () => {
    const { service } = await ready([]);
    mocked.findOpenRow.mockResolvedValue(
      presenceRow({ bindingId: null, payloadHash: 'a-real-render' }),
    );

    service.markDirty(VOICE);
    await service.flushNow();

    // `binding_id` is NULL exactly on this path (ON DELETE SET NULL) AND the
    // channel resolves to no binding either, so nothing anywhere can name the
    // sessions this message covered. Rewriting would replace a real record of
    // them with "No session started." at exactly the moment it became history.
    // This is the ONE case that still keeps its last render (ROK-1524).
    expect(mocked.editEmbeds).not.toHaveBeenCalled();
    expect(mocked.closeRow).toHaveBeenCalledWith(
      expect.anything(),
      'row-1',
      'unbound',
      expect.any(Date),
    );
  });

  it("recaps an orphaned row against the CHANNEL's current binding (ROK-1524)", async () => {
    // The channel IS bound — `ready()` hands the service a live `general-lobby`
    // record — but the ROW's `binding_id` is NULL. That pair is reachable and
    // the voice smoke hits it every run: the old binding was deleted (ON DELETE
    // SET NULL nulled this column) and a new one was created for the same
    // channel, so `flushChannel` resolves a binding and never reaches
    // `closeUnbound`'s S-7 guard. Hydrating with the row's NULL key returns []
    // and overwrites a real session with "No session started." (the ticket's
    // bug); publishing nothing instead leaves a LIVE embed that never folds
    // into its session-ended card (D8). Neither is the answer: the sessions are
    // real and hang off whatever binding owns the channel now, so recap
    // against THAT.
    const { service } = await ready();
    mocked.resolveRoom.mockResolvedValue(room({ memberCount: 0, groups: [] }));
    mocked.findOpenRow.mockResolvedValue(
      presenceRow({ bindingId: null, payloadHash: 'a-real-render' }),
    );
    mocked.recapEvents.mockResolvedValue([
      { id: 900, gameId: 7, adHocStatus: 'live' },
    ]);

    service.markDirty(VOICE);
    await service.flushNow();

    // Hydrated by the channel's binding, over the row's own open window.
    expect(mocked.recapEvents).toHaveBeenCalledWith(
      expect.anything(),
      BINDING,
      OPENED_AT,
    );
    expect(mocked.editEmbeds).toHaveBeenCalledTimes(1);
    const embeds = mocked.editEmbeds.mock.calls[0][3];
    expect(embeds[0].data.title).toContain('session ended');
    // The ticket's symptom, asserted directly: a session that really happened
    // must never be reported as none.
    expect(embeds[0].data.description).not.toBe('No session started.');
    expect(embeds[0].data.description).toContain('1 session');
    expect(embeds).toHaveLength(2);
    expect(embeds[1].data.author?.name).toContain('ENDED');
    // The rest of the D8 ladder is untouched.
    expect(mocked.markEmpty).toHaveBeenCalledTimes(1);
  });

  it('warns about the orphaned row once per empty transition, not per tick (ROK-1524)', async () => {
    const { service } = await ready();
    const warnings = loggerWarnings(service);
    mocked.resolveRoom.mockResolvedValue(room({ memberCount: 0, groups: [] }));
    mocked.findOpenRow.mockResolvedValue(presenceRow({ bindingId: null }));

    service.markDirty(VOICE);
    await service.flushNow();
    // Second tick of the SAME empty stretch: `empty_since` is already stamped,
    // so the row is not transitioning any more. A warn per five-second flush
    // would bury the log for the whole grace period.
    mocked.findOpenRow.mockResolvedValue(
      presenceRow({ bindingId: null, emptySince: new Date(NOW) }),
    );
    service.markDirty(VOICE);
    await service.flushNow();

    expect(warnings).toHaveBeenCalledTimes(1);
    expect(warnings).toHaveBeenCalledWith(
      expect.stringContaining('lost its binding id'),
    );
  });
});

describe('ChannelPresenceEmbedService — a deleted message must not wedge the room', () => {
  it('closes the row missing on a 10008 edit and reposts on the next flush (P2-1)', async () => {
    const { service } = await ready();
    mocked.findOpenRow.mockResolvedValueOnce(presenceRow());
    mocked.editEmbeds.mockRejectedValueOnce(unknownMessage());

    service.markDirty(VOICE);
    await service.flushNow();

    // Leaving the row `open` wedges the channel forever: every later occupancy
    // finds it and edits the dead id, and the reaper sees a healthy row.
    expect(mocked.closeRow).toHaveBeenCalledWith(
      expect.anything(),
      'row-1',
      'missing',
    );
    expect(mocked.savePayloadHash).not.toHaveBeenCalled();

    // `findOpenRow` now answers null, as the closed row would.
    service.markDirty(VOICE);
    await service.flushNow();

    // A REPLACEMENT message, not a second doomed edit - and reached on the
    // very next flush, because a 10008 is handled rather than thrown and so
    // never spends an S-1 retry.
    expect(mocked.sendEmbeds).toHaveBeenCalledTimes(1);
    expect(mocked.editEmbeds).toHaveBeenCalledTimes(1);
  });

  it('still propagates a NON-10008 edit failure into the retry budget', async () => {
    const { service } = await ready();
    mocked.findOpenRow.mockResolvedValue(presenceRow());
    mocked.editEmbeds
      .mockRejectedValueOnce(new Error('discord 500'))
      .mockResolvedValue({ id: MESSAGE } as never);
    service.onModuleInit();
    service.markDirty(VOICE);

    await jest.advanceTimersByTimeAsync(PRESENCE_FLUSH_INTERVAL_MS * 2);

    // A transient 5xx must NOT close the row - that would retire a live
    // message - and must be retried.
    expect(mocked.closeRow).not.toHaveBeenCalled();
    expect(mocked.editEmbeds).toHaveBeenCalledTimes(2);
    service.onModuleDestroy();
  });
});
