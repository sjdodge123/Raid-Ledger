/**
 * ROK-1612 AC1 — where the pinned composer goes, and that it never throws.
 * ROK-1658 — the composer has no opt-in of its own: it follows the board.
 */
import { ChannelType } from 'discord.js';
import { SETTING_KEYS } from '../../drizzle/schema';
import type { LfgDb } from '../../lfg/lfg-query.helpers';
import type { SettingsService } from '../../settings/settings.service';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import { LfgComposerPinService } from './lfg-composer-pin.service';
import { LFG_COMPOSER_IDS } from './lfg-composer.constants';
import { LFG_BOARD_EVENTS } from '../lfg-board/lfg-board.constants';
import { buildComposerCard } from './lfg-composer-card.helpers';

const BOT = 'bot-user';
/** ROK-1658 — the LFG board switched on; the composer rides it. */
const ON = { [SETTING_KEYS.LFG_BOARD_ENABLED]: 'true' };

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
  it('board on with NO composer setting row puts the buttons on the intro, in place (ROK-1658 deploy case)', async () => {
    const starter = {
      author: { id: BOT },
      components: [],
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
    const svc = service({ c1: text }, ON, 'c1');
    await expect(svc.reconcile()).resolves.toBe('posted-pinned');
    expect(posted.pin).toHaveBeenCalledTimes(1);
  });
});

describe('LfgComposerPinService.reconcile — no target, no throw', () => {
  it('no board and no binding: nothing is posted', async () => {
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

describe('LfgComposerPinService.reconcile — board off, legacy text binding', () => {
  const composerRow = {
    components: [{ customId: LFG_COMPOSER_IDS.OPEN }],
  };

  it('board off deletes a card left from before and posts nothing', async () => {
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

describe('LfgComposerPinService.reconcile — board switched off (ROK-1658)', () => {
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
      [SETTING_KEYS.LFG_BOARD_ENABLED]: 'false',
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
      [SETTING_KEYS.LFG_BOARD_ENABLED]: 'false',
      [SETTING_KEYS.LFG_BOARD_INTRO_THREAD_ID]: 't1',
    };
    await expect(service({ t1: intro }, cfg, null).reconcile()).resolves.toBe(
      'no-target',
    );
    expect(starter.edit).not.toHaveBeenCalled();
  });
});

describe('LfgComposerPinService.reconcile — board off, intro AND legacy text binding (review NIT)', () => {
  const composerRow = {
    components: [{ customId: LFG_COMPOSER_IDS.OPEN }],
  };

  it('with an intro stored AND a legacy text binding, also deletes the text card', async () => {
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
    const cfg = {
      [SETTING_KEYS.LFG_BOARD_ENABLED]: 'false',
      [SETTING_KEYS.LFG_BOARD_INTRO_THREAD_ID]: 't1',
    };
    await service({ t1: intro, c1: text }, cfg, 'c1').reconcile();
    expect(starter.edit).toHaveBeenCalledWith({ components: [] });
    expect(card.delete).toHaveBeenCalledTimes(1);
    expect(text.send).not.toHaveBeenCalled();
  });
});

describe('LfgComposerPinService — board toggle (ROK-1658)', () => {
  function spied() {
    const svc = service({}, ON, null);
    const reconcile = jest
      .spyOn(svc, 'reconcile')
      .mockResolvedValue('no-target');
    return { svc, reconcile };
  }

  it('takes the composer down as soon as the board is switched off', async () => {
    const { svc, reconcile } = spied();
    await svc.onBoardToggled({ enabled: false });
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it('ignores the ON toggle: ENABLED owns it, after provisioning', async () => {
    const { svc, reconcile } = spied();
    await svc.onBoardToggled({ enabled: true });
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('is subscribed to the board TOGGLED event', () => {
    // Scanned by method, so a missing subscription reads as `[]`, not a throw.
    const proto = LfgComposerPinService.prototype as unknown as Record<
      string,
      unknown
    >;
    const onToggled = Object.getOwnPropertyNames(proto).filter((name) => {
      const method = proto[name];
      if (typeof method !== 'function') return false;
      const events = Reflect.getMetadata('EVENT_LISTENER_METADATA', method) as
        { event: unknown }[] | undefined;
      return (events ?? []).some((e) => e.event === LFG_BOARD_EVENTS.TOGGLED);
    });
    expect(onToggled).toEqual(['onBoardToggled']);
  });
});

/** A text channel whose `send` holds until released — the race window. */
function gatedText() {
  const all: Record<string, unknown>[] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const own = (m: Record<string, unknown>) => m.author === BOT_AUTHOR;
  const text = {
    id: 'c1',
    type: ChannelType.GuildText,
    all,
    send: jest.fn(async () => {
      await gate;
      const message: Record<string, unknown> = {
        id: `m${String(all.length + 1)}`,
        pinned: false,
        author: BOT_AUTHOR,
        components: [{ components: [{ customId: LFG_COMPOSER_IDS.OPEN }] }],
        edit: jest.fn(() => Promise.resolve()),
        pin: jest.fn(() => {
          message.pinned = true;
          return Promise.resolve();
        }),
        delete: jest.fn(() => {
          all.splice(all.indexOf(message), 1);
          return Promise.resolve();
        }),
      };
      all.push(message);
      return message;
    }),
    messages: {
      fetchPins: () =>
        Promise.resolve({
          items: all.filter((m) => m.pinned).map((message) => ({ message })),
        }),
      fetch: () => Promise.resolve(all.slice().reverse()),
    },
  };
  return { text, release: () => release(), cards: () => all.filter(own) };
}

const BOT_AUTHOR = { id: BOT };
/** Let every pending microtask run — both reconciles reach `send` or wait. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('LfgComposerPinService.reconcile — serialised (review MAJOR)', () => {
  it('two concurrent reconciles post ONE card', async () => {
    const { text, release, cards } = gatedText();
    const svc = service({ c1: text }, { ...ON }, 'c1');
    const a = svc.reconcile();
    const b = svc.reconcile();
    await settle();
    release();
    await Promise.all([a, b]);
    expect(text.send).toHaveBeenCalledTimes(1);
    expect(cards()).toHaveLength(1);
  });

  it('ON then OFF in quick succession ends with no card up', async () => {
    const { text, release, cards } = gatedText();
    const cfg: Record<string, string> = { ...ON };
    const svc = service({ c1: text }, cfg, 'c1');
    const on = svc.reconcile();
    await settle();
    cfg[SETTING_KEYS.LFG_BOARD_ENABLED] = 'false';
    const off = svc.reconcile();
    await settle();
    release();
    await Promise.all([on, off]);
    expect(cards()).toHaveLength(0);
  });
});

describe('LfgComposerPinService.reconcile — intro already current (review NIT)', () => {
  it('does not re-edit an intro post whose buttons already match', async () => {
    const card = buildComposerCard('https://raid.example');
    const starter = {
      author: { id: BOT },
      components: card.components,
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
      'intro-unchanged',
    );
    expect(starter.edit).not.toHaveBeenCalled();
  });
});
