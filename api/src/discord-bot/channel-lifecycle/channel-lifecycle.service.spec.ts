/**
 * ROK-1431 — ChannelLifecycleService unit spec (spec ROK-1428 §2.5, D9/D13/D14).
 * Discord ops, the activity query and the DB writes are mocked at the module
 * boundary; the real plan / run / apply code runs.
 */
import { ConflictException } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { ChannelLifecycleSettingsDto } from '@raid-ledger/contract';
import * as ops from './channel-lifecycle.discord-ops';
import * as resolver from './hub-link.resolver';
import * as hubQueries from './hub-channel-link.queries';
import { CreateCapacityError } from './channel-lifecycle.errors';
import { PERMISSION_ERROR_TEXT } from './channel-lifecycle.run';
import * as queries from './game-activity.queries';
import * as store from './channel-lifecycle.store';
import * as storeQueries from './channel-lifecycle.store.queries';
import {
  ChannelGoneError,
  LifecyclePermissionError,
} from './channel-lifecycle.errors';
import { ChannelLifecycleService } from './channel-lifecycle.service';
import type { GameLifecycleActivityRow } from './game-activity.types';
import type { SettingsService } from '../../settings/settings.service';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import type { ChannelBindingsService } from '../services/channel-bindings.service';
import type { LifecycleDb } from './channel-lifecycle.store';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));
jest.mock('./channel-lifecycle.discord-ops');
jest.mock('./game-activity.queries');
jest.mock('./channel-lifecycle.store.queries');
jest.mock('./hub-link.resolver');
jest.mock('./hub-channel-link.queries');
jest.mock('./channel-lifecycle.store', () => ({
  withReconcileLock: jest.fn(
    async (_db: unknown, fn: () => Promise<unknown>) => ({
      acquired: true,
      value: await fn(),
    }),
  ),
  setLifecycleState: jest.fn(),
  insertSuppression: jest.fn(),
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

function row(
  gameId: number,
  o: Partial<GameLifecycleActivityRow> = {},
): GameLifecycleActivityRow {
  return {
    gameId,
    gameName: `Game ${gameId}`,
    gameSlug: `game-${gameId}`,
    signals: [],
    itemCount: 0,
    lastActivityAt: null,
    hubHold: false,
    hubNeedsLink: false,
    suppressed: false,
    binding: null,
    ...o,
  };
}
function bound(
  gameId: number,
  o: Partial<NonNullable<GameLifecycleActivityRow['binding']>> = {},
  items = 0,
): GameLifecycleActivityRow {
  return row(gameId, {
    itemCount: items,
    binding: {
      id: `b-${gameId}`,
      guildId: 'g1',
      channelId: `ch-${gameId}`,
      lifecycleState: 'active',
      autoManaged: true,
      pinned: false,
      archivedAt: null,
      restoreParentId: null,
      archivedOverwrites: null,
      ...o,
    },
  });
}

const settings = {
  getChannelLifecycleSettings: jest.fn(),
  setChannelLifecycleSettings: jest.fn(),
  recordChannelLifecycleRun: jest.fn(),
  getClientUrl: jest.fn().mockResolvedValue('https://rl.test'),
};
const client = { isConnected: jest.fn(), getGuild: jest.fn() };
const bindings = { bind: jest.fn(), unbindById: jest.fn() };
const hubLinker = { linkHubsForGame: jest.fn().mockResolvedValue(0) };
const guild = { id: 'g1', channels: { delete: jest.fn() } };
const selectRows = jest.mocked(queries.selectGameLifecycleActivity);

function makeService(): ChannelLifecycleService {
  return new ChannelLifecycleService(
    {} as LifecycleDb,
    settings as unknown as SettingsService,
    client as unknown as DiscordBotClientService,
    bindings as unknown as ChannelBindingsService,
    hubLinker,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  settings.getChannelLifecycleSettings.mockResolvedValue(SETTINGS);
  client.isConnected.mockReturnValue(true);
  client.getGuild.mockReturnValue(guild);
  jest.mocked(ops.ensureCategory).mockImplementation((_g, o) =>
    Promise.resolve({
      id: o.id ?? 'new',
      name: o.name,
      created: false,
    }),
  );
  jest.mocked(ops.createTextChannel).mockResolvedValue('new-ch');
  jest.mocked(ops.categorySeriesIds).mockReturnValue(new Set());
  jest.mocked(ops.categoryHasRoom).mockResolvedValue(true);
  jest.mocked(resolver.resolveGameHubLink).mockResolvedValue(null);
  jest.mocked(ops.archiveChannel).mockResolvedValue({
    previousParentId: 'cat-games',
    restoreParentId: 'cat-games',
    added: { everyoneSend: true, everyoneView: false, botView: false },
  });
  jest.mocked(storeQueries.findGameAnnouncementBinding).mockResolvedValue(null);
  bindings.bind.mockResolvedValue({
    binding: { id: 'b-new' },
    replacedChannelIds: [],
  });
  selectRows.mockResolvedValue([]);
});

const live = { dryRun: false, trigger: 'manual' as const };

describe('gates', () => {
  it('disabled → stoppedReason disabled, no query', async () => {
    settings.getChannelLifecycleSettings.mockResolvedValue({
      ...SETTINGS,
      enabled: false,
    });
    expect((await makeService().reconcile(live)).stoppedReason).toBe(
      'disabled',
    );
    expect(selectRows).not.toHaveBeenCalled();
  });
  it('bot offline → stoppedReason offline', async () => {
    client.isConnected.mockReturnValue(false);
    expect((await makeService().reconcile(live)).stoppedReason).toBe('offline');
  });
  it('archive category unresolvable → no-archive-category + lastRunError', async () => {
    jest.mocked(ops.ensureCategory).mockImplementation((_g, o) => {
      if (o.name === 'Archived') return Promise.reject(new Error('nope'));
      return Promise.resolve({ id: 'cat-games', name: o.name, created: false });
    });
    expect((await makeService().reconcile(live)).stoppedReason).toBe(
      'no-archive-category',
    );
    expect(settings.recordChannelLifecycleRun).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(String) }),
    );
  });
  it('persists found-or-created category ids (OQ-6)', async () => {
    settings.getChannelLifecycleSettings.mockResolvedValue({
      ...SETTINGS,
      gamesCategoryId: null,
      archiveCategoryId: null,
    });
    await makeService().reconcile(live);
    expect(settings.setChannelLifecycleSettings).toHaveBeenCalledWith({
      gamesCategoryId: 'new',
      archiveCategoryId: 'new',
    });
  });
  it('single-flight: a held lock → ConflictException', async () => {
    jest
      .mocked(store.withReconcileLock)
      .mockResolvedValueOnce({ acquired: false });
    await expect(makeService().reconcile(live)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
  it('a failing run record rejects promptly instead of hanging (R13)', async () => {
    selectRows.mockResolvedValue([]);
    const boom = new Error('Failed query: insert into "app_settings"');
    settings.recordChannelLifecycleRun
      .mockRejectedValueOnce(boom)
      .mockRejectedValueOnce(boom);
    await expect(makeService().reconcile(live)).rejects.toBe(boom);
    expect(store.withReconcileLock).toHaveBeenCalledTimes(1);
  });
});

describe('actions', () => {
  it('create → channel named by slug under Games, bound, marked auto-managed, clean run recorded', async () => {
    selectRows.mockResolvedValue([row(1, { itemCount: 2 })]);
    const res = await makeService().reconcile(live);
    expect(ops.createTextChannel).toHaveBeenCalledWith(
      guild,
      expect.objectContaining({ name: 'game-1', parentId: 'cat-games' }),
    );
    expect(bindings.bind).toHaveBeenCalledWith(
      'g1',
      'new-ch',
      'text',
      'game-announcements',
      1,
    );
    expect(store.setLifecycleState).toHaveBeenCalledWith(
      expect.anything(),
      'b-new',
      { autoManaged: true, lifecycleState: 'active' },
    );
    expect(hubLinker.linkHubsForGame).toHaveBeenCalledWith(1, 'new-ch');
    expect(res.created).toBe(1);
    expect(settings.recordChannelLifecycleRun).toHaveBeenCalledWith(
      expect.objectContaining({ error: null }),
    );
  });
  it('bind conflict after create → orphan channel deleted, failed (R18)', async () => {
    selectRows.mockResolvedValue([row(1, { itemCount: 2 })]);
    bindings.bind.mockRejectedValue(new ConflictException('taken'));
    const res = await makeService().reconcile(live);
    expect(guild.channels.delete).toHaveBeenCalledWith(
      'new-ch',
      expect.any(String),
    );
    expect(res.failed).toBe(1);
    expect(store.setLifecycleState).not.toHaveBeenCalled();
  });
  it('archive stores the previous parent; unarchive restores it', async () => {
    selectRows.mockResolvedValue([
      bound(1),
      bound(2, { lifecycleState: 'archived', restoreParentId: 'old-cat' }, 1),
    ]);
    const res = await makeService().reconcile(live);
    expect(store.setLifecycleState).toHaveBeenCalledWith(
      expect.anything(),
      'b-1',
      expect.objectContaining({
        lifecycleState: 'archived',
        restoreParentId: 'cat-games',
      }),
    );
    expect(ops.unarchiveChannel).toHaveBeenCalledWith(guild, 'ch-2', {
      parentId: 'old-cat',
      added: null,
    });
    expect(res).toMatchObject({ archived: 1, unarchived: 1 });
  });
  it('pinned and manual bindings are never mutated', async () => {
    selectRows.mockResolvedValue([
      bound(1, { pinned: true }),
      bound(2, { autoManaged: false }),
    ]);
    const res = await makeService().reconcile(live);
    expect(ops.archiveChannel).not.toHaveBeenCalled();
    expect(store.setLifecycleState).not.toHaveBeenCalled();
    expect(res.skipped).toBe(2);
  });
  it('link_hub calls the injectable seam', async () => {
    selectRows.mockResolvedValue(
      [bound(1, {}, 1)].map((r) => ({ ...r, hubNeedsLink: true })),
    );
    hubLinker.linkHubsForGame.mockResolvedValue(1);
    expect((await makeService().reconcile(live)).linkedHubs).toBe(1);
  });
});

describe('error policy (D9/D14)', () => {
  it('one game failing never blocks the next; Sentry once with the action tag', async () => {
    selectRows.mockResolvedValue([bound(1), bound(2)]);
    jest.mocked(ops.archiveChannel).mockRejectedValueOnce(new Error('boom'));
    const res = await makeService().reconcile(live);
    expect(res).toMatchObject({ failed: 1, archived: 1 });
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: { area: 'channel-lifecycle-archive' } }),
    );
  });
  it('a permission error stops the tick with ONE captureMessage', async () => {
    selectRows.mockResolvedValue([bound(1), bound(2), bound(3)]);
    jest
      .mocked(ops.archiveChannel)
      .mockRejectedValue(new LifecyclePermissionError('archive.move', 50013));
    const res = await makeService().reconcile(live);
    expect(res.stoppedReason).toBe('permissions');
    expect(ops.archiveChannel).toHaveBeenCalledTimes(1);
    expect(res.deferred).toBe(2);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(settings.recordChannelLifecycleRun).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining('Manage Channels'),
      }),
    );
  });
  it('10003 → suppression deleted, then unbind, no Sentry', async () => {
    selectRows.mockResolvedValue([bound(1)]);
    jest
      .mocked(ops.archiveChannel)
      .mockRejectedValue(new ChannelGoneError('ch-1'));
    const res = await makeService().reconcile(live);
    expect(store.insertSuppression).toHaveBeenCalledWith(expect.anything(), {
      guildId: 'g1',
      gameId: 1,
      reason: 'deleted',
    });
    expect(bindings.unbindById).toHaveBeenCalledWith('b-1');
    expect(res.items[0]).toMatchObject({
      outcome: 'failed',
      detail: 'channel deleted in Discord',
    });
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});

describe('cap + dry run', () => {
  it('maxChangesPerTick: creates first, the rest deferred', async () => {
    settings.getChannelLifecycleSettings.mockResolvedValue({
      ...SETTINGS,
      maxChangesPerTick: 2,
    });
    selectRows.mockResolvedValue([
      bound(9),
      row(1, { itemCount: 2 }),
      row(2, { itemCount: 3 }),
    ]);
    const res = await makeService().reconcile(live);
    expect(res).toMatchObject({ created: 2, archived: 0, deferred: 1 });
    expect(res.items.find((i) => i.gameId === 9)?.outcome).toBe('deferred');
  });
  it('dry run: planned items, no Discord call, no write', async () => {
    selectRows.mockResolvedValue([row(1, { itemCount: 2 }), bound(2)]);
    const res = await makeService().reconcile({
      dryRun: true,
      trigger: 'manual',
    });
    expect(res.items.map((i) => i.outcome)).toEqual(['planned', 'planned']);
    expect(res).toMatchObject({ dryRun: true, created: 1, archived: 1 });
    for (const fn of Object.values(ops))
      if (jest.isMockFunction(fn)) expect(fn).not.toHaveBeenCalled();
    expect(store.setLifecycleState).not.toHaveBeenCalled();
    expect(settings.recordChannelLifecycleRun).not.toHaveBeenCalled();
    expect(settings.setChannelLifecycleSettings).not.toHaveBeenCalled();
  });
});

const ADDED = { everyoneSend: true, everyoneView: true, botView: false };
const nudge = { dryRun: false, trigger: 'nudge' as const, gameIds: [1] };

describe('review fixes — archive / unarchive', () => {
  it('records the bits archive added; unarchive clears only those', async () => {
    jest.mocked(ops.archiveChannel).mockResolvedValue({
      previousParentId: 'cat-arch',
      restoreParentId: null,
      added: ADDED,
    });
    selectRows.mockResolvedValue([bound(1)]);
    await makeService().reconcile(live);
    expect(store.setLifecycleState).toHaveBeenCalledWith(
      expect.anything(),
      'b-1',
      expect.objectContaining({
        restoreParentId: null,
        archivedOverwrites: ADDED,
      }),
    );
    expect(ops.archiveChannel).toHaveBeenCalledWith(
      guild,
      'ch-1',
      expect.objectContaining({ seriesIds: expect.any(Set) }),
    );
  });
  it('a failed archive DB write reverts the Discord side', async () => {
    selectRows.mockResolvedValue([bound(1)]);
    jest.mocked(store.setLifecycleState).mockRejectedValueOnce(new Error('db'));
    const res = await makeService().reconcile(live);
    expect(ops.revertArchive).toHaveBeenCalledWith(guild, 'ch-1', {
      previousParentId: 'cat-games',
      restoreParentId: 'cat-games',
      added: { everyoneSend: true, everyoneView: false, botView: false },
    });
    expect(res.failed).toBe(1);
  });
  it('unarchive passes the recorded bits; a deleted restore parent falls back to Games', async () => {
    jest.mocked(ops.categoryHasRoom).mockResolvedValue(false);
    selectRows.mockResolvedValue([
      bound(
        2,
        {
          lifecycleState: 'archived',
          restoreParentId: 'gone-cat',
          archivedOverwrites: ADDED,
        },
        1,
      ),
    ]);
    await makeService().reconcile(live);
    expect(ops.unarchiveChannel).toHaveBeenCalledWith(guild, 'ch-2', {
      parentId: 'cat-games',
      added: ADDED,
    });
  });
  it('a FULL restore parent overflows to a Games category with room (r2 P2)', async () => {
    jest.mocked(ops.categoryHasRoom).mockResolvedValue(false);
    jest.mocked(ops.ensureCategory).mockImplementation((_g, o) =>
      Promise.resolve({
        id: o.needsRoom ? `${o.id ?? 'new'}-2` : (o.id ?? 'new'),
        name: o.name,
        created: false,
      }),
    );
    selectRows.mockResolvedValue([
      bound(2, { lifecycleState: 'archived', restoreParentId: 'full-cat' }, 1),
    ]);
    await makeService().reconcile(live);
    expect(ops.categoryHasRoom).toHaveBeenCalledWith(guild, 'full-cat');
    expect(ops.ensureCategory).toHaveBeenCalledWith(guild, {
      id: 'cat-games',
      name: expect.any(String),
      needsRoom: true,
    });
    expect(ops.unarchiveChannel).toHaveBeenCalledWith(
      guild,
      'ch-2',
      expect.objectContaining({ parentId: 'cat-games-2' }),
    );
  });
});

describe('review fixes — create capacity, topic, gone hubs', () => {
  it('creates under a Games category WITH room (overflow-aware)', async () => {
    selectRows.mockResolvedValue([row(1, { itemCount: 3 })]);
    await makeService().reconcile(live);
    expect(ops.ensureCategory).toHaveBeenCalledWith(guild, {
      id: 'cat-games',
      name: expect.any(String),
      needsRoom: true,
    });
  });
  it('30013 defers the remaining creates with ONE Sentry message', async () => {
    selectRows.mockResolvedValue(
      [1, 2, 3].map((g) => row(g, { itemCount: 3 })),
    );
    jest
      .mocked(ops.createTextChannel)
      .mockRejectedValue(new CreateCapacityError('create'));
    const res = await makeService().reconcile(live);
    expect(ops.createTextChannel).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ failed: 1, deferred: 2 });
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
  it('a hub link refreshes the topic with the hub URL (D10)', async () => {
    selectRows.mockResolvedValue(
      [bound(1, {}, 1)].map((r) => ({ ...r, hubNeedsLink: true })),
    );
    hubLinker.linkHubsForGame.mockResolvedValue(1);
    const url = 'https://rl.test/guilds/7';
    jest
      .mocked(resolver.resolveGameHubLink)
      .mockResolvedValue({ url, label: 'Hub' });
    await makeService().reconcile(live);
    expect(ops.setTopic).toHaveBeenCalledWith(
      guild,
      'ch-1',
      expect.stringContaining(url),
    );
  });
  it('a gone channel clears its auto-linked hubs', async () => {
    selectRows.mockResolvedValue([bound(1)]);
    jest
      .mocked(ops.archiveChannel)
      .mockRejectedValue(new ChannelGoneError('ch-1'));
    await makeService().reconcile(live);
    expect(hubQueries.unlinkAutoHubsForChannel).toHaveBeenCalledWith(
      expect.anything(),
      'ch-1',
    );
  });
});

describe('review fixes — nudge ticks', () => {
  it('a clean nudge tick does not clear lastRunError', async () => {
    selectRows.mockResolvedValue([]);
    await makeService().reconcile(nudge);
    expect(settings.recordChannelLifecycleRun).not.toHaveBeenCalled();
  });
  it('a nudge skips the permission Sentry when it is already recorded', async () => {
    settings.getChannelLifecycleSettings.mockResolvedValue({
      ...SETTINGS,
      lastRunError: PERMISSION_ERROR_TEXT,
    });
    selectRows.mockResolvedValue([bound(1)]);
    jest
      .mocked(ops.archiveChannel)
      .mockRejectedValue(new LifecyclePermissionError('archive.move', 50013));
    const res = await makeService().reconcile(nudge);
    expect(res.stoppedReason).toBe('permissions');
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(settings.recordChannelLifecycleRun).toHaveBeenCalledTimes(1);
  });
});
