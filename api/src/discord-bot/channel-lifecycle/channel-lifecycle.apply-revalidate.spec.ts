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
  action: 'archive' | 'unarchive',
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

  it('a still-eligible binding is archived', async () => {
    lock.mockResolvedValue(CURRENT);
    const item = await applyAction(makeCtx(), planned('archive'));
    expect(ops.archiveChannel).toHaveBeenCalledTimes(1);
    expect(item.outcome).toBe('done');
  });
});
