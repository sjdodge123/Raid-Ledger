import { SETTING_KEYS } from '../drizzle/schema';
import type { SettingsCore } from './settings-bot.helpers';
import {
  getLfgBoardChannelId,
  getLfgBoardEnabled,
  getLfgBoardIntroThreadId,
  setLfgBoardChannelId,
  setLfgBoardEnabled,
  setLfgBoardIntroThreadId,
} from './settings-lfg-board.helpers';

function fakeCore(values: Record<string, string | null> = {}) {
  const get = jest.fn((key: string) => Promise.resolve(values[key] ?? null));
  const set = jest.fn(() => Promise.resolve(undefined));
  return { core: { get, set } as unknown as SettingsCore, get, set };
}

describe('settings-lfg-board.helpers (ROK-1471)', () => {
  it('board toggle defaults to OFF when the key is unset', async () => {
    const { core } = fakeCore();
    await expect(getLfgBoardEnabled(core)).resolves.toBe(false);
  });

  it('board toggle reads true only for the literal "true"', async () => {
    const { core } = fakeCore({ [SETTING_KEYS.LFG_BOARD_ENABLED]: 'true' });
    await expect(getLfgBoardEnabled(core)).resolves.toBe(true);
  });

  it('setLfgBoardEnabled writes the string form', async () => {
    const { core, set } = fakeCore();
    await setLfgBoardEnabled(core, true);
    expect(set).toHaveBeenCalledWith(SETTING_KEYS.LFG_BOARD_ENABLED, 'true');
    await setLfgBoardEnabled(core, false);
    expect(set).toHaveBeenLastCalledWith(
      SETTING_KEYS.LFG_BOARD_ENABLED,
      'false',
    );
  });

  it('channel id is null until set, and round-trips', async () => {
    const { core, set } = fakeCore({ [SETTING_KEYS.LFG_BOARD_CHANNEL_ID]: '' });
    await expect(getLfgBoardChannelId(core)).resolves.toBeNull();
    await setLfgBoardChannelId(core, '123456789012345678');
    expect(set).toHaveBeenCalledWith(
      SETTING_KEYS.LFG_BOARD_CHANNEL_ID,
      '123456789012345678',
    );
    const { core: core2 } = fakeCore({
      [SETTING_KEYS.LFG_BOARD_CHANNEL_ID]: '123456789012345678',
    });
    await expect(getLfgBoardChannelId(core2)).resolves.toBe(
      '123456789012345678',
    );
  });
});

describe('settings-lfg-board.helpers — intro thread id (ROK-1471 A4)', () => {
  it('intro thread id is null until one has been created', async () => {
    const { core } = fakeCore();
    await expect(getLfgBoardIntroThreadId(core)).resolves.toBeNull();
  });

  it('treats an empty stored value as "no intro post yet"', async () => {
    const { core } = fakeCore({
      [SETTING_KEYS.LFG_BOARD_INTRO_THREAD_ID]: '',
    });
    await expect(getLfgBoardIntroThreadId(core)).resolves.toBeNull();
  });

  it('round-trips the intro thread id under its own key', async () => {
    const { core, set } = fakeCore();
    await setLfgBoardIntroThreadId(core, '222222222222222222');
    expect(set).toHaveBeenCalledWith(
      SETTING_KEYS.LFG_BOARD_INTRO_THREAD_ID,
      '222222222222222222',
    );

    const { core: reread } = fakeCore({
      [SETTING_KEYS.LFG_BOARD_INTRO_THREAD_ID]: '222222222222222222',
    });
    await expect(getLfgBoardIntroThreadId(reread)).resolves.toBe(
      '222222222222222222',
    );
  });

  it('does not collide with the board channel id key', async () => {
    const { core } = fakeCore({
      [SETTING_KEYS.LFG_BOARD_CHANNEL_ID]: '111111111111111111',
    });
    await expect(getLfgBoardIntroThreadId(core)).resolves.toBeNull();
  });
});
