/**
 * ROK-1432 — admin-side lifecycle service: the enable guard (D5) and the
 * suppression "Recreate" 404 path. Discord ops + the store are spied.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Guild } from 'discord.js';
import type { ChannelLifecycleSettingsDto } from '@raid-ledger/contract';
import type { SettingsService } from '../../settings/settings.service';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import {
  PIN_MANUAL_REFUSED,
  assertPinnable,
  buildBindingUpdateSet,
} from '../services/channel-bindings-invariant.helpers';
import * as ops from './channel-lifecycle.discord-ops';
import * as store from './channel-lifecycle.store';
import * as queries from './game-activity.queries';
import type { HubLinker } from './channel-lifecycle.types';
import type { LifecycleDb } from './channel-lifecycle.store';
import {
  ChannelLifecycleAdminService,
  ENABLE_REFUSED,
} from './channel-lifecycle-admin.service';

const BASE: ChannelLifecycleSettingsDto = {
  enabled: false,
  recentActivityDays: 30,
  createThreshold: 2,
  gamesCategoryId: null,
  archiveCategoryId: null,
  hideOnArchive: false,
  maxChangesPerTick: 10,
  lastRunAt: null,
  lastRunError: null,
};
const guild = { id: 'g1' } as unknown as Guild;

function build(connected = true, hubLinker?: HubLinker) {
  const settings = {
    getChannelLifecycleSettings: jest.fn().mockResolvedValue(BASE),
    setChannelLifecycleSettings: jest
      .fn()
      .mockImplementation((p: object) => Promise.resolve({ ...BASE, ...p })),
  };
  const client = {
    isConnected: jest.fn().mockReturnValue(connected),
    getGuild: jest.fn().mockReturnValue(connected ? guild : null),
    getGuildId: jest.fn().mockReturnValue(connected ? 'g1' : null),
  };
  const svc = new ChannelLifecycleAdminService(
    {} as LifecycleDb,
    settings as unknown as SettingsService,
    client as unknown as DiscordBotClientService,
    hubLinker,
  );
  return { svc, settings };
}

function stubCategories(archive: 'ok' | 'fail'): jest.SpyInstance {
  return jest.spyOn(ops, 'ensureCategory').mockImplementation((_g, o) => {
    if (o.name === 'Archived' && archive === 'fail') {
      return Promise.reject(new Error('Missing Permissions'));
    }
    const id = o.name === 'Games' ? 'cat-games' : 'cat-arch';
    return Promise.resolve({ id, name: o.name, created: true });
  });
}

afterEach(() => jest.restoreAllMocks());

describe('updateSettings — enable guard', () => {
  it('refuses enable with 400 when the bot is offline', async () => {
    const { svc, settings } = build(false);
    const spy = stubCategories('ok');
    await expect(svc.updateSettings({ enabled: true })).rejects.toThrow(
      new BadRequestException(ENABLE_REFUSED),
    );
    expect(spy).not.toHaveBeenCalled();
    expect(settings.setChannelLifecycleSettings).not.toHaveBeenCalled();
  });

  it('refuses enable with 400 when the archive category cannot be resolved', async () => {
    const { svc, settings } = build();
    stubCategories('fail');
    await expect(svc.updateSettings({ enabled: true })).rejects.toThrow(
      ENABLE_REFUSED,
    );
    expect(settings.setChannelLifecycleSettings).not.toHaveBeenCalled();
  });

  it('persists the found/created category ids on enable', async () => {
    const { svc, settings } = build();
    stubCategories('ok');
    const out = await svc.updateSettings({ enabled: true });
    expect(settings.setChannelLifecycleSettings).toHaveBeenCalledWith({
      enabled: true,
      gamesCategoryId: 'cat-games',
      archiveCategoryId: 'cat-arch',
    });
    expect(out.archiveCategoryId).toBe('cat-arch');
  });

  it('passes a non-enable patch straight through without Discord', async () => {
    const { svc, settings } = build(false);
    const spy = stubCategories('ok');
    await svc.updateSettings({ recentActivityDays: 14 });
    expect(spy).not.toHaveBeenCalled();
    expect(settings.setChannelLifecycleSettings).toHaveBeenCalledWith({
      recentActivityDays: 14,
    });
  });

  it('rejects an unknown key with 400 before touching settings', async () => {
    const { svc, settings } = build();
    await expect(svc.updateSettings({ bogus: 1 })).rejects.toThrow(
      BadRequestException,
    );
    expect(settings.setChannelLifecycleSettings).not.toHaveBeenCalled();
  });
});

describe('activity preview — hub-link parity with reconcile (Codex r2 P2)', () => {
  it("passes the hub linker's hubNeedsLinkGameIds into the derivation", async () => {
    const ids = new Set([7]);
    const linker: HubLinker = {
      linkHubsForGame: jest.fn().mockResolvedValue(0),
      hubNeedsLinkGameIds: jest.fn().mockResolvedValue(ids),
    };
    const select = jest
      .spyOn(queries, 'selectGameLifecycleActivity')
      .mockResolvedValue([]);
    await build(true, linker).svc.activity(true);
    expect(select).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ hubNeedsLinkGameIds: ids }),
    );
  });

  it('without a linker the derivation gets an empty set', async () => {
    const select = jest
      .spyOn(queries, 'selectGameLifecycleActivity')
      .mockResolvedValue([]);
    await build().svc.activity(false);
    expect(select).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ hubNeedsLinkGameIds: new Set() }),
    );
  });
});

describe('clearSuppression', () => {
  it('resolves when a suppression row was removed', async () => {
    const { svc } = build();
    const del = jest.spyOn(store, 'deleteSuppression').mockResolvedValue(true);
    await expect(svc.clearSuppression(7)).resolves.toBeUndefined();
    expect(del).toHaveBeenCalledWith({}, 'g1', 7);
  });

  it('throws 404 when the game has no suppression', async () => {
    const { svc } = build();
    jest.spyOn(store, 'deleteSuppression').mockResolvedValue(false);
    await expect(svc.clearSuppression(7)).rejects.toThrow(NotFoundException);
  });

  it('throws 404 when the bot has no guild', async () => {
    const { svc } = build(false);
    const del = jest.spyOn(store, 'deleteSuppression');
    await expect(svc.clearSuppression(7)).rejects.toThrow(NotFoundException);
    expect(del).not.toHaveBeenCalled();
  });
});

describe('assertPinnable (PATCH bindings pinned rule)', () => {
  it('400s pinned on a manual binding', () => {
    expect(() =>
      assertPinnable({ autoManaged: false }, { pinned: true }),
    ).toThrow(new BadRequestException(PIN_MANUAL_REFUSED));
  });

  it('allows pinned on an auto-managed binding and ignores an absent flag', () => {
    expect(() =>
      assertPinnable({ autoManaged: true }, { pinned: true }),
    ).not.toThrow();
    expect(() => assertPinnable({ autoManaged: false }, {})).not.toThrow();
  });

  it('puts pinned into the update set only when provided', () => {
    const existing = {
      config: null,
      bindingPurpose: 'game-announcements',
      autoManaged: true,
    };
    expect(
      buildBindingUpdateSet(existing, {}, undefined, { pinned: true }),
    ).toMatchObject({ pinned: true });
    expect(
      buildBindingUpdateSet(existing, {}, undefined, {}),
    ).not.toHaveProperty('pinned');
  });
});

describe('activity ?all=true widens the game set (Codex r3 P2)', () => {
  it.each([true, false])(
    'passes allGames=%s into the derivation',
    async (all) => {
      const select = jest
        .spyOn(queries, 'selectGameLifecycleActivity')
        .mockResolvedValue([]);
      await build().svc.activity(all);
      expect(select).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ allGames: all }),
      );
    },
  );
});
