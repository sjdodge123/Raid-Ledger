/**
 * ROK-1428 Codex r6 P2 — a managed channel deleted by hand while its game is
 * still active (hubs linked) plans `none`, so no Discord op ever runs for it
 * and the ChannelGoneError cleanup never fired. The reconcile now checks the
 * channel still exists (cache, then fetch) and, on Unknown Channel (10003)
 * ONLY, runs the same unbind + suppress + clear-auto-hubs cleanup.
 */
import { DiscordAPIError, type Guild } from 'discord.js';
import type { ChannelLifecycleSettingsDto } from '@raid-ledger/contract';
import { planReconcile } from './channel-lifecycle.plan';
import { executePlan } from './channel-lifecycle.run';
import { insertSuppression } from './channel-lifecycle.store';
import { unlinkAutoHubsForChannel } from './hub-channel-link.queries';
import type { ApplyContext } from './channel-lifecycle.types';
import type { GameLifecycleActivityRow } from './game-activity.types';
import type { ChannelBindingsService } from '../services/channel-bindings.service';
import type { LifecycleDb } from './channel-lifecycle.store';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));
jest.mock('./channel-lifecycle.store', () => ({
  insertSuppression: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./hub-channel-link.queries', () => ({
  unlinkAutoHubsForChannel: jest.fn().mockResolvedValue(undefined),
}));

const SETTINGS: ChannelLifecycleSettingsDto = {
  enabled: true,
  recentActivityDays: 30,
  createThreshold: 2,
  gamesCategoryId: 'cat-games',
  archiveCategoryId: 'cat-arch',
  hideOnArchive: false,
  maxChangesPerTick: 10,
  lastRunAt: null,
  lastRunError: null,
};

/** An active game whose auto-managed channel is live and hub-linked (`none`). */
function activeRow(): GameLifecycleActivityRow {
  return {
    gameId: 7,
    gameName: 'Valheim',
    gameSlug: 'valheim',
    signals: [],
    itemCount: 3,
    lastActivityAt: new Date('2026-10-19T00:00:00Z'),
    hubHold: true,
    hubNeedsLink: false,
    suppressed: false,
    binding: {
      id: 'bind-1',
      guildId: 'guild-1',
      channelId: 'chan-dead',
      lifecycleState: 'active',
      autoManaged: true,
      pinned: false,
      archivedAt: null,
      restoreParentId: null,
      archivedOverwrites: null,
    },
  };
}

function discordError(code: number): DiscordAPIError {
  const err: DiscordAPIError = Object.create(DiscordAPIError.prototype);
  Object.defineProperty(err, 'code', { value: code });
  Object.defineProperty(err, 'message', { value: `Discord ${code}` });
  return err;
}

interface Harness {
  ctx: ApplyContext;
  unbindById: jest.Mock;
  fetch: jest.Mock;
}

/** A context whose guild cache is empty and whose fetch does `fetchImpl`. */
function harness(fetchImpl: () => Promise<unknown>, cached = false): Harness {
  const unbindById = jest.fn().mockResolvedValue(true);
  const fetch = jest.fn(fetchImpl);
  const cache = new Map<string, unknown>(cached ? [['chan-dead', {}]] : []);
  const db = {
    transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  } as unknown as LifecycleDb;
  const ctx = {
    guild: { id: 'guild-1', channels: { cache, fetch } } as unknown as Guild,
    db,
    bindings: { unbindById } as unknown as ChannelBindingsService,
    settings: SETTINGS,
    categories: { gamesId: 'cat-games', archiveId: 'cat-arch' },
    hubLinker: { linkHubsForGame: jest.fn() },
    clientUrl: 'https://rl.example',
    now: new Date('2026-10-20T00:00:00Z'),
  } satisfies ApplyContext;
  return { ctx, unbindById, fetch };
}

describe('reconcile — hand-deleted managed channel on a `none` game', () => {
  beforeEach(() => jest.clearAllMocks());

  it('unbinds, suppresses and clears auto hubs when fetch says 10003', async () => {
    const h = harness(() => Promise.reject(discordError(10003)));
    const plan = planReconcile([activeRow()], SETTINGS);
    const result = await executePlan(h.ctx, plan);
    expect(h.unbindById).toHaveBeenCalledWith('bind-1', expect.anything());
    expect(insertSuppression).toHaveBeenCalledWith(expect.anything(), {
      guildId: 'guild-1',
      gameId: 7,
      reason: 'deleted',
    });
    expect(unlinkAutoHubsForChannel).toHaveBeenCalledWith(
      expect.anything(),
      'chan-dead',
    );
    expect(result).toMatchObject({ failed: 1, skipped: 0 });
  });

  it('leaves a cached (live) channel alone without fetching', async () => {
    const h = harness(() => Promise.reject(discordError(10003)), true);
    const result = await executePlan(
      h.ctx,
      planReconcile([activeRow()], SETTINGS),
    );
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.unbindById).not.toHaveBeenCalled();
    expect(result).toMatchObject({ failed: 0, skipped: 1 });
  });

  it('treats only 10003 as gone — a 50001 Missing Access keeps the binding', async () => {
    const h = harness(() => Promise.reject(discordError(50001)));
    const result = await executePlan(
      h.ctx,
      planReconcile([activeRow()], SETTINGS),
    );
    expect(h.unbindById).not.toHaveBeenCalled();
    expect(insertSuppression).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      failed: 0,
      skipped: 1,
      stoppedReason: null,
    });
  });
});
