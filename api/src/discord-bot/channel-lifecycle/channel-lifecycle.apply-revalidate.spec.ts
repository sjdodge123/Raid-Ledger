/**
 * ROK-1428 Codex r9 P2 — the apply re-reads and row-locks the binding on the
 * game's transaction and re-validates it BEFORE any Discord mutation. A
 * binding an admin pinned (or that changed) between the activity snapshot
 * and this game's turn in a bulk reconcile is left alone: the Redis lease
 * excludes other reconciles, not a binding PATCH.
 */
import type { ChannelLifecycleSettingsDto } from '@raid-ledger/contract';
import type { Guild } from 'discord.js';
import * as ops from './channel-lifecycle.discord-ops';
import * as queries from './channel-lifecycle.store.queries';
import * as store from './channel-lifecycle.store';
import { applyAction } from './channel-lifecycle.apply';
import type { ApplyContext, PlannedGame } from './channel-lifecycle.types';
import type { LifecycleCandidateBinding } from './game-activity.types';
import type { ChannelBindingsService } from '../services/channel-bindings.service';
import type { LifecycleDb } from './channel-lifecycle.store';

jest.mock('./channel-lifecycle.discord-ops');
jest.mock('./channel-lifecycle.store.queries');
jest.mock('./channel-lifecycle.store');

const BINDING: LifecycleCandidateBinding = {
  id: 'b-7',
  guildId: 'g1',
  channelId: 'ch-7',
  lifecycleState: 'active',
  autoManaged: true,
  pinned: false,
  archivedAt: null,
  restoreParentId: null,
  archivedOverwrites: null,
};

/** The tx handle the run hands the apply (identity-checked below). */
const TX = { tx: true } as unknown as LifecycleDb;

function planned(
  action: 'archive' | 'unarchive' | 'link_hub',
  binding: LifecycleCandidateBinding = BINDING,
): PlannedGame {
  return {
    action,
    reason: 'planned',
    row: {
      gameId: 7,
      gameName: 'Valheim',
      gameSlug: 'valheim',
      signals: [],
      itemCount: 0,
      lastActivityAt: null,
      hubHold: false,
      hubNeedsLink: false,
      suppressed: false,
      binding,
    },
  };
}

function makeCtx(): ApplyContext {
  return {
    guild: { id: 'g1' } as unknown as Guild,
    db: TX,
    bindings: {} as unknown as ChannelBindingsService,
    settings: { hideOnArchive: false } as ChannelLifecycleSettingsDto,
    categories: { gamesId: 'cat-games', archiveId: 'cat-arch' },
    hubLinker: { linkHubsForGame: jest.fn() },
    clientUrl: 'https://rl.test',
    now: new Date('2026-10-20T00:00:00Z'),
  };
}

const lock = jest.mocked(queries.lockLifecycleBinding);

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(queries.countOtherChannelBindings).mockResolvedValue(0);
  jest.mocked(store.setLifecycleState).mockResolvedValue(undefined);
  jest.mocked(ops.ensureCategory).mockResolvedValue({
    id: 'cat-arch',
    name: 'Archived',
    created: false,
  });
  jest.mocked(ops.categorySeriesIds).mockReturnValue(new Set());
  jest.mocked(ops.categoryHasRoom).mockResolvedValue(true);
  jest.mocked(ops.archiveChannel).mockResolvedValue({
    previousParentId: 'cat-games',
    restoreParentId: 'cat-games',
    added: { everyoneSend: true, everyoneView: false, botView: false },
  });
});

const CURRENT = {
  channelId: 'ch-7',
  autoManaged: true,
  pinned: false,
  lifecycleState: 'active',
  gameId: 7,
  bindingPurpose: 'game-announcements',
  recurrenceGroupId: null,
};

describe('apply re-validates the locked binding (Codex r9 P2)', () => {
  it('a binding pinned since the read is not archived', async () => {
    lock.mockResolvedValue({ ...CURRENT, pinned: true });
    const item = await applyAction(makeCtx(), planned('archive'));
    expect(lock).toHaveBeenCalledWith(TX, 'b-7');
    expect(ops.archiveChannel).not.toHaveBeenCalled();
    expect(store.setLifecycleState).not.toHaveBeenCalled();
    expect(item).toEqual({
      outcome: 'deferred',
      detail: 'skipped: pinned since the read',
    });
  });

  it('a binding unarchived since the read is not unarchived again', async () => {
    lock.mockResolvedValue({ ...CURRENT, lifecycleState: 'active' });
    const archived = { ...BINDING, lifecycleState: 'archived' as const };
    const item = await applyAction(makeCtx(), planned('unarchive', archived));
    expect(ops.unarchiveChannel).not.toHaveBeenCalled();
    expect(item.detail).toBe('skipped: state changed since the read');
  });

  it.each([
    [null, 'skipped: binding removed since the read'],
    [{ ...CURRENT, autoManaged: false }, 'skipped: no longer auto-managed'],
    [
      { ...CURRENT, channelId: 'ch-9' },
      'skipped: channel changed since the read',
    ],
  ])('a stale binding (%p) is skipped', async (current, detail) => {
    lock.mockResolvedValue(current);
    const item = await applyAction(makeCtx(), planned('archive'));
    expect(ops.archiveChannel).not.toHaveBeenCalled();
    expect(item).toEqual({ outcome: 'deferred', detail });
  });

  // Codex r10 P2: a binding reassigned via updateConfig() between the
  // snapshot and the apply must not be archived on the old game's inactivity.
  it.each([
    [{ ...CURRENT, gameId: 9 }, 'skipped: reassigned to another game'],
    [
      { ...CURRENT, bindingPurpose: 'general-lfg' },
      'skipped: purpose changed since the read',
    ],
    [
      { ...CURRENT, recurrenceGroupId: 'series-1' },
      'skipped: purpose changed since the read',
    ],
  ])('a re-routed binding (%p) is skipped', async (current, detail) => {
    lock.mockResolvedValue(current);
    const item = await applyAction(makeCtx(), planned('archive'));
    expect(ops.archiveChannel).not.toHaveBeenCalled();
    expect(store.setLifecycleState).not.toHaveBeenCalled();
    expect(item).toEqual({ outcome: 'deferred', detail });
  });

  it('a still-eligible binding is archived', async () => {
    lock.mockResolvedValue(CURRENT);
    const item = await applyAction(makeCtx(), planned('archive'));
    expect(ops.archiveChannel).toHaveBeenCalledTimes(1);
    expect(item.outcome).toBe('done');
  });
});

// Codex r11 P2: link_hub re-reads + locks the binding too — a binding
// re-routed since the snapshot must not be linked to the old game's hubs.
describe('link_hub re-validates the locked binding (Codex r11 P2)', () => {
  it.each([
    [null, 'skipped: binding removed since the read'],
    [{ ...CURRENT, gameId: 9 }, 'skipped: reassigned to another game'],
    [
      { ...CURRENT, bindingPurpose: 'quick-play-announcements' },
      'skipped: purpose changed since the read',
    ],
    [
      { ...CURRENT, channelId: 'ch-9' },
      'skipped: channel changed since the read',
    ],
  ])('a re-routed binding (%p) is not linked', async (current, detail) => {
    lock.mockResolvedValue(current);
    const ctx = makeCtx();
    const item = await applyAction(ctx, planned('link_hub'));
    expect(lock).toHaveBeenCalledWith(TX, 'b-7');
    expect(ctx.hubLinker.linkHubsForGame).not.toHaveBeenCalled();
    expect(item).toEqual({ outcome: 'deferred', detail });
  });

  it('a still-routed manual binding is linked without a topic rewrite', async () => {
    lock.mockResolvedValue({ ...CURRENT, autoManaged: false });
    const ctx = makeCtx();
    jest
      .mocked(ctx.hubLinker.linkHubsForGame)
      .mockResolvedValue({ channelId: 'ch-7', guildIds: [1] });
    const item = await applyAction(ctx, planned('link_hub'));
    expect(ctx.hubLinker.linkHubsForGame).toHaveBeenCalledWith(7, 'ch-7', TX);
    expect(ops.setTopic).not.toHaveBeenCalled();
    expect(item).toEqual({
      outcome: 'done',
      detail: 'planned',
      linkedHubs: 1,
      linked: { channelId: 'ch-7', guildIds: [1] },
    });
  });
});

describe('unarchive compensates a failed persist (Codex r17 P2)', () => {
  it('re-locks + moves back to Archived when the DB write throws', async () => {
    lock.mockResolvedValue({ ...CURRENT, lifecycleState: 'archived' });
    const added = { everyoneSend: true, everyoneView: false, botView: false };
    const archived = {
      ...BINDING,
      lifecycleState: 'archived' as const,
      restoreParentId: 'cat-games',
      archivedOverwrites: added,
    };
    jest
      .mocked(ops.unarchiveChannel)
      .mockResolvedValue({ previousParentId: 'cat-arch' });
    const boom = new Error('db down');
    jest.mocked(store.setLifecycleState).mockRejectedValue(boom);
    const ctx = makeCtx();
    await expect(applyAction(ctx, planned('unarchive', archived))).rejects.toBe(
      boom,
    );
    expect(ops.unarchiveChannel).toHaveBeenCalled();
    expect(ops.revertUnarchive).toHaveBeenCalledWith(ctx.guild, 'ch-7', {
      parentId: 'cat-arch',
      added,
    });
  });

  it('does not compensate a successful unarchive', async () => {
    lock.mockResolvedValue({ ...CURRENT, lifecycleState: 'archived' });
    const archived = { ...BINDING, lifecycleState: 'archived' as const };
    jest
      .mocked(ops.unarchiveChannel)
      .mockResolvedValue({ previousParentId: 'cat-arch' });
    const item = await applyAction(makeCtx(), planned('unarchive', archived));
    expect(item.outcome).toBe('done');
    expect(ops.revertUnarchive).not.toHaveBeenCalled();
  });
});
