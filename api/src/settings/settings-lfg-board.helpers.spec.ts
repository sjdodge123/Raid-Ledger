import { SETTING_KEYS } from '../drizzle/schema';
import type { SettingsCore } from './settings-bot.helpers';
import {
  getLfgBoardChannelId,
  getLfgBoardEnabled,
  setLfgBoardChannelId,
  setLfgBoardEnabled,
} from './settings-lfg-board.helpers';

function fakeCore(values: Record<string, string | null> = {}) {
  const get = jest.fn(async (key: string) => values[key] ?? null);
  const set = jest.fn(async () => undefined);
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
    expect(set).toHaveBeenLastCalledWith(SETTING_KEYS.LFG_BOARD_ENABLED, 'false');
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
    await expect(getLfgBoardChannelId(core2)).resolves.toBe('123456789012345678');
  });
});
