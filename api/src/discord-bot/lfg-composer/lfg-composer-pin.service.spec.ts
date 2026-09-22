/**
 * ROK-1612 AC1 — where the pinned composer goes, and that it never throws.
 */
import { ChannelType } from 'discord.js';
import { SETTING_KEYS } from '../../drizzle/schema';
import type { LfgDb } from '../../lfg/lfg-query.helpers';
import type { SettingsService } from '../../settings/settings.service';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import { LfgComposerPinService } from './lfg-composer-pin.service';
import { LFG_COMPOSER_IDS } from './lfg-composer.constants';

const BOT = 'bot-user';

function settings(values: Record<string, string>): SettingsService {
  return {
    get: jest.fn((key: string) => Promise.resolve(values[key] ?? null)),
    getClientUrl: jest.fn(() => Promise.resolve('https://raid.example')),
  } as unknown as SettingsService;
}

function db(boundChannelId: string | null): LfgDb {
  const rows = boundChannelId ? [{ channelId: boundChannelId }] : [];
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(rows),
  };
  return chain as unknown as LfgDb;
}

function service(
  channels: Record<string, unknown>,
  cfg: Record<string, string>,
  bound: string | null,
) {
  const guild = {
    id: 'g1',
    channels: {
      fetch: jest.fn((id: string) => Promise.resolve(channels[id] ?? null)),
    },
  };
  const client = {
    getGuild: () => guild,
    getBotUser: () => ({ id: BOT, username: 'rl' }),
  } as unknown as DiscordBotClientService;
  return new LfgComposerPinService(client, settings(cfg), db(bound));
}

describe('LfgComposerPinService.reconcile', () => {
  it('forum board: sets the composer buttons on the pinned intro post, in place', async () => {
    const starter = {
      author: { id: BOT },
      edit: jest.fn(() => Promise.resolve()),
    };
    const intro = {
      id: 't1',
      isThread: () => true,
      fetchStarterMessage: () => Promise.resolve(starter),
    };
    const svc = service(
      { t1: intro },
      {
        [SETTING_KEYS.LFG_BOARD_ENABLED]: 'true',
        [SETTING_KEYS.LFG_BOARD_INTRO_THREAD_ID]: 't1',
      },
      null,
    );
    await expect(svc.reconcile()).resolves.toBe('intro-edited');
    await expect(svc.reconcile()).resolves.toBe('intro-edited');
    expect(starter.edit).toHaveBeenCalledTimes(2);
    const [payload] = starter.edit.mock.calls[0] as unknown as [
      { components: { toJSON(): unknown }[]; content?: string },
    ];
    expect(payload.content).toBeUndefined();
    expect(JSON.stringify(payload.components.map((c) => c.toJSON()))).toContain(
      LFG_COMPOSER_IDS.OPEN,
    );
  });

  it('text binding: posts and pins the card in the bound channel', async () => {
    const posted = {
      id: 'm1',
      pinned: false,
      author: { id: BOT },
      components: [],
      edit: jest.fn(),
      pin: jest.fn(() => Promise.resolve()),
      delete: jest.fn(),
    };
    const text = {
      id: 'c1',
      type: ChannelType.GuildText,
      send: jest.fn(() => Promise.resolve(posted)),
      messages: {
        fetchPins: () => Promise.resolve({ items: [] }),
        fetch: () => Promise.resolve([]),
      },
    };
    const svc = service({ c1: text }, {}, 'c1');
    await expect(svc.reconcile()).resolves.toBe('posted-pinned');
    expect(posted.pin).toHaveBeenCalledTimes(1);
  });
});

describe('LfgComposerPinService.reconcile — no target, no throw', () => {
  it('no board and no binding: nothing is posted (AC6 opt-in)', async () => {
    await expect(service({}, {}, null).reconcile()).resolves.toBe('no-target');
  });

  it('a Discord failure resolves to null instead of throwing', async () => {
    const text = {
      id: 'c1',
      type: ChannelType.GuildText,
      messages: { fetchPins: () => Promise.reject(new Error('503')) },
    };
    await expect(
      service({ c1: text }, {}, 'c1').reconcile(),
    ).resolves.toBeNull();
  });
});
