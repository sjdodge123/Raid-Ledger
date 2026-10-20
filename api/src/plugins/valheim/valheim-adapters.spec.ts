import { EXTENSION_POINTS } from '../plugin-host/extension-points';
import type { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import {
  ValheimAdapterRegistration,
  VALHEIM_LOG_PARSER,
} from './valheim-adapters';
import { VALHEIM_MANIFEST } from './valheim.manifest';

describe('Valheim plugin registration', () => {
  it('registers the log parser under the valheim slug, owned by the plugin', () => {
    const registerAdapter = jest.fn();
    const registry = { registerAdapter } as unknown as PluginRegistryService;
    new ValheimAdapterRegistration(registry).onModuleInit();
    expect(registerAdapter).toHaveBeenCalledWith(
      EXTENSION_POINTS.GAME_LOG_PARSER,
      'valheim',
      VALHEIM_LOG_PARSER,
      { ownerPluginId: 'valheim' },
    );
  });

  it('the registered parser is the Valheim line parser', () => {
    expect(VALHEIM_LOG_PARSER.pluginSlug).toBe('valheim');
    expect(
      VALHEIM_LOG_PARSER.parse('Got handshake from client 76561190000000001'),
    ).toEqual({ kind: 'join', steamId: '76561190000000001' });
  });

  it('declares the valheim game slug and an install-time pelican dependency', () => {
    expect(VALHEIM_MANIFEST).toMatchObject({
      id: 'valheim',
      gameSlugs: ['valheim'],
      dependencies: ['pelican'],
      capabilities: ['game-log-parser', 'cron-registrar'],
    });
  });
});
