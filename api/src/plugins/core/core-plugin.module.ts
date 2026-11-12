import { Logger, Module, type OnModuleInit } from '@nestjs/common';
import { CORE_PLUGIN_ID } from '@raid-ledger/contract';
import { bestEffortInit } from '../../common/lifecycle.util';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import { CORE_MANIFEST } from './core.manifest';
import { CoreSteamStatsModule } from './steam-stats/core-steam-stats.module';
import { GgCardModule } from './gg/gg-card.module';

/**
 * ROK-1969 D2 — registers the Core manifest and installs its row on boot
 * (same pattern as Discord / Blizzard). Core is active regardless (D3), so
 * a failed install only hides it from `GET /admin/plugins` until next boot.
 */
// ROK-2187: GgCardModule is @Global — every plugin registers its GG cards.
@Module({ imports: [CoreSteamStatsModule, GgCardModule] })
export class CorePluginModule implements OnModuleInit {
  private readonly logger = new Logger(CorePluginModule.name);

  constructor(private readonly pluginRegistry: PluginRegistryService) {}

  async onModuleInit(): Promise<void> {
    await bestEffortInit('CorePluginModule.init', this.logger, async () => {
      this.pluginRegistry.registerManifest(CORE_MANIFEST);
      await this.pluginRegistry.ensureInstalled(CORE_PLUGIN_ID);
    });
  }
}
