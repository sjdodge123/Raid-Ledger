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
import { LFG_BOARD_EVENTS } from '../lfg-board/lfg-board.constants';

const BOT = 'bot-user';
/** AC6 — the composer's opt-in, switched on. */
const ON = { [SETTING_KEYS.LFG_COMPOSER_ENABLED]: 'true' };

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
        ...ON,
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
    const svc = service({ c1: text }, ON, 'c1');
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
      service({ c1: text }, ON, 'c1').reconcile(),
    ).resolves.toBeNull();
  });
});

describe('LfgComposerPinService.reconcile — AC6 opt-in off (the default)', () => {
  const composerRow = {
    components: [{ customId: LFG_COMPOSER_IDS.OPEN }],
  };

  it('text binding: posts nothing and deletes a card left from before', async () => {
    const card = {
      id: 'm1',
      pinned: true,
      author: { id: BOT },
      components: [composerRow],
      delete: jest.fn(() => Promise.resolve()),
    };
    const text = {
      id: 'c1',
      type: ChannelType.GuildText,
      send: jest.fn(),
      messages: {
        fetchPins: () => Promise.resolve({ items: [{ message: card }] }),
        fetch: () => Promise.resolve([card]),
      },
    };
    await expect(service({ c1: text }, {}, 'c1').reconcile()).resolves.toBe(
      'removed',
    );
    expect(card.delete).toHaveBeenCalledTimes(1);
    expect(text.send).not.toHaveBeenCalled();
  });
});

describe('LfgComposerPinService.reconcile — AC6 off on a forum board', () => {
  const composerRow = {
    components: [{ customId: LFG_COMPOSER_IDS.OPEN }],
  };

  it('strips the composer buttons from the intro post', async () => {
    const starter = {
      author: { id: BOT },
      components: [composerRow],
      edit: jest.fn(() => Promise.resolve()),
    };
    const intro = {
      id: 't1',
      isThread: () => true,
      fetchStarterMessage: () => Promise.resolve(starter),
    };
    const cfg = {
      [SETTING_KEYS.LFG_BOARD_ENABLED]: 'true',
      [SETTING_KEYS.LFG_BOARD_INTRO_THREAD_ID]: 't1',
    };
    await expect(service({ t1: intro }, cfg, null).reconcile()).resolves.toBe(
      'intro-cleared',
    );
    expect(starter.edit).toHaveBeenCalledWith({ components: [] });
  });

  it('leaves an intro without the buttons untouched', async () => {
    const starter = {
      author: { id: BOT },
      components: [],
      edit: jest.fn(),
    };
    const intro = {
      id: 't1',
      isThread: () => true,
      fetchStarterMessage: () => Promise.resolve(starter),
    };
    const cfg = {
      [SETTING_KEYS.LFG_BOARD_ENABLED]: 'true',
      [SETTING_KEYS.LFG_BOARD_INTRO_THREAD_ID]: 't1',
    };
    await expect(service({ t1: intro }, cfg, null).reconcile()).resolves.toBe(
      'no-target',
    );
    expect(starter.edit).not.toHaveBeenCalled();
  });
});

describe('LfgComposerPinService — admin toggle (ROK-1612 AC6)', () => {
  it('reconciles as soon as the opt-in is flipped, not on the next reconnect', async () => {
    const svc = service({}, ON, null);
    const reconcile = jest
      .spyOn(svc, 'reconcile')
      .mockResolvedValue('no-target');

    await svc.onComposerToggled();

    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it('is subscribed to COMPOSER_TOGGLED', () => {
    const events: unknown = Reflect.getMetadata(
      'EVENT_LISTENER_METADATA',
      LfgComposerPinService.prototype.onComposerToggled,
    );
    expect(events).toEqual([
      expect.objectContaining({ event: LFG_BOARD_EVENTS.COMPOSER_TOGGLED }),
    ]);
  });
});
