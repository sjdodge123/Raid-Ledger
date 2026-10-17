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
  // Not `async` arrows: they have nothing to await, which `require-await`
  // rejects as an error (pre-existing at the wave-2 integration tip).
  const get = jest.fn((key: string) => Promise.resolve(values[key] ?? null));
  const set = jest.fn(() => Promise.resolve());
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

  it('intro thread id is null until one has been posted', async () => {
    const { core } = fakeCore();
    await expect(getLfgBoardIntroThreadId(core)).resolves.toBeNull();
    // An empty string is what a cleared setting reads back as, and treating it
    // as a thread id would make `threads.fetch('')` the enable path's first act.
    const { core: cleared } = fakeCore({
      [SETTING_KEYS.LFG_BOARD_INTRO_THREAD_ID]: '',
    });
    await expect(getLfgBoardIntroThreadId(cleared)).resolves.toBeNull();
  });

  it('intro thread id round-trips under its own key', async () => {
    const { core, set } = fakeCore();
    await setLfgBoardIntroThreadId(core, '987654321098765432');
    expect(set).toHaveBeenCalledWith(
      SETTING_KEYS.LFG_BOARD_INTRO_THREAD_ID,
      '987654321098765432',
    );
    // A shared key would make enabling the board forget the forum channel.
    expect(SETTING_KEYS.LFG_BOARD_INTRO_THREAD_ID).not.toBe(
      SETTING_KEYS.LFG_BOARD_CHANNEL_ID,
    );
    const { core: stored } = fakeCore({
      [SETTING_KEYS.LFG_BOARD_INTRO_THREAD_ID]: '987654321098765432',
    });
    await expect(getLfgBoardIntroThreadId(stored)).resolves.toBe(
      '987654321098765432',
    );
  });
});
