import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { SETTING_KEYS } from '../../drizzle/schema/app-settings';
import { SettingsService } from '../../settings/settings.service';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import { PLUGIN_EVENTS } from '../plugin-host/plugin-manifest.interface';
import { PelicanModule } from './pelican.module';
import { PELICAN_MANIFEST } from './pelican.manifest';

const PELICAN_KEYS = [
  SETTING_KEYS.PELICAN_PANEL_URL,
  SETTING_KEYS.PELICAN_CLIENT_API_KEY,
  SETTING_KEYS.PELICAN_DEFAULT_TIMEZONE,
];

async function build() {
  const cache = new Map<string, string>([
    [SETTING_KEYS.PELICAN_CLIENT_API_KEY, 'pacc_cached'],
    [SETTING_KEYS.PELICAN_PANEL_URL, 'https://panel.example.test'],
    [SETTING_KEYS.DEFAULT_TIMEZONE, 'UTC'],
  ]);
  const settings = {
    get: jest.fn((k: string) => Promise.resolve(cache.get(k) ?? null)),
    delete: jest.fn((k: string) => {
      cache.delete(k);
      return Promise.resolve();
    }),
    invalidateCache: jest.fn(),
  };
  const registry = { registerManifest: jest.fn(), ensureInstalled: jest.fn() };
  const emitter = new EventEmitter2();
  const mod = await Test.createTestingModule({
    providers: [
      PelicanModule,
      { provide: SettingsService, useValue: settings },
      { provide: PluginRegistryService, useValue: registry },
      { provide: EventEmitter2, useValue: emitter },
    ],
  }).compile();
  const pelican = mod.get(PelicanModule);
  pelican.onModuleInit();
  return { pelican, settings, registry, emitter };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('PelicanModule', () => {
  it('registers the manifest only — never auto-installs', async () => {
    const { registry } = await build();
    expect(registry.registerManifest).toHaveBeenCalledWith(PELICAN_MANIFEST);
    expect(registry.ensureInstalled).not.toHaveBeenCalled();
  });

  it('evicts every Pelican key from the settings cache on uninstall', async () => {
    const { settings, emitter } = await build();
    emitter.emit(PLUGIN_EVENTS.UNINSTALLED, { slug: 'pelican' });
    await flush();
    expect(settings.delete.mock.calls.map(([k]) => k)).toEqual(PELICAN_KEYS);
    for (const key of PELICAN_KEYS) {
      expect(await settings.get(key)).toBeNull();
    }
  });

  it('leaves the cache alone when another plugin is uninstalled', async () => {
    const { settings, emitter } = await build();
    emitter.emit(PLUGIN_EVENTS.UNINSTALLED, { slug: 'ai' });
    await flush();
    expect(settings.delete).not.toHaveBeenCalled();
  });

  it('stops listening after onModuleDestroy', async () => {
    const { pelican, settings, emitter } = await build();
    pelican.onModuleDestroy();
    emitter.emit(PLUGIN_EVENTS.UNINSTALLED, { slug: 'pelican' });
    await flush();
    expect(settings.delete).not.toHaveBeenCalled();
  });
});
