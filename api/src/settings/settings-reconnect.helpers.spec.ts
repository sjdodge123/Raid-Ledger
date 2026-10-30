import { EventEmitter2 } from '@nestjs/event-emitter';
import { SETTING_KEYS } from '../drizzle/schema';
import { SETTINGS_EVENTS } from './settings.types';
import { emitOAuthReconnect } from './settings-reconnect.helpers';

function run(entries: [string, string][]): jest.Mock {
  const emit = jest.fn();
  const emitter = { emit } as unknown as EventEmitter2;
  emitOAuthReconnect(new Map(entries), emitter);
  return emit;
}

describe('emitOAuthReconnect (ROK-1697)', () => {
  const creds: [string, string][] = [
    [SETTING_KEYS.DISCORD_CLIENT_ID, 'id-1'],
    [SETTING_KEYS.DISCORD_CLIENT_SECRET, 'secret-1'],
  ];

  it('emits with a blank callback when none is saved', () => {
    const emit = run(creds);
    expect(emit).toHaveBeenCalledWith(SETTINGS_EVENTS.OAUTH_DISCORD_UPDATED, {
      clientId: 'id-1',
      clientSecret: 'secret-1',
      callbackUrl: '',
    });
  });

  it('passes a saved callback through', () => {
    const emit = run([
      ...creds,
      [SETTING_KEYS.DISCORD_CALLBACK_URL, 'https://rl.example/api/auth/cb'],
    ]);
    expect(emit).toHaveBeenCalledWith(
      SETTINGS_EVENTS.OAUTH_DISCORD_UPDATED,
      expect.objectContaining({
        callbackUrl: 'https://rl.example/api/auth/cb',
      }),
    );
  });

  it('does not emit without both credentials', () => {
    expect(
      run([[SETTING_KEYS.DISCORD_CLIENT_ID, 'id-1']]),
    ).not.toHaveBeenCalled();
  });
});
