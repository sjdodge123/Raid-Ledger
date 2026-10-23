/** ROK-1933 Part 4 — the listener swallows + logs async failures. */
import { Logger } from '@nestjs/common';
import { HubWelcomeListener } from './hub-welcome.listener';
import type { HubWelcomeService } from './hub-welcome.service';

function make(welcome: Partial<HubWelcomeService>): HubWelcomeListener {
  return new HubWelcomeListener(welcome as HubWelcomeService);
}

describe('HubWelcomeListener', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('passes the payload channel to welcomeLinked', async () => {
    const welcomeLinked = jest.fn(() => Promise.resolve(null));
    await make({ welcomeLinked }).onLinked({
      guildId: 7,
      channelId: 'c9',
      previousChannelId: null,
    });
    expect(welcomeLinked).toHaveBeenCalledWith(7, 'c9');
  });

  it('logs a rejected welcome instead of rethrowing', async () => {
    const welcomeLinked = jest.fn(() => Promise.reject(new Error('boom')));
    await expect(
      make({ welcomeLinked }).onLinked({
        guildId: 7,
        channelId: 'c9',
        previousChannelId: null,
      }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('Hub 7 welcome (linked) failed: boom');
  });

  it('logs a rejected removal instead of rethrowing', async () => {
    const removeWelcome = jest.fn(() => Promise.reject(new Error('gone')));
    await expect(
      make({ removeWelcome }).onCleared({ guildId: 3, previousChannelId: 'c' }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('Hub 3 welcome (cleared) failed: gone');
  });
});
