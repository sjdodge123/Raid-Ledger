import { Module, OnModuleInit } from '@nestjs/common';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import { VALHEIM_MANIFEST } from './valheim.manifest';
import { ValheimAdapterRegistration } from './valheim-adapters';

/**
 * Valheim game plugin (ROK-1800). Registers its manifest only — no
 * `ensureInstalled`, so an uninstall survives a restart (as Pelican).
 */
@Module({
  providers: [ValheimAdapterRegistration],
})
export class ValheimModule implements OnModuleInit {
  constructor(private readonly pluginRegistry: PluginRegistryService) {}

  onModuleInit(): void {
    this.pluginRegistry.registerManifest(VALHEIM_MANIFEST);
  }
}
