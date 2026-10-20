import { Module } from '@nestjs/common';
import { SettingsModule } from '../../../settings/settings.module';
import { PelicanModule } from '../../pelican/pelican.module';
import { PelicanConfigService } from '../../pelican/pelican-config.service';
import { ValheimArmoryContainersDemoSeedController } from '../armory/valheim-armory-containers-demo-seed.controller';
import { ValheimArmoryDemoSeedController } from '../armory/valheim-armory-demo-seed.controller';
import { ValheimArmoryMapDemoSeedController } from '../armory/valheim-armory-map-demo-seed.controller';
import { ValheimArmoryRecipesDemoSeedController } from '../armory/valheim-armory-recipes-demo-seed.controller';
import { ValheimLinkDemoSeedController } from './valheim-link-demo-seed.controller';
import { ValheimLinkTokensRepository } from './valheim-link-tokens.repository';
import { ValheimLinkTokensService } from './valheim-link-tokens.service';

/**
 * ROK-1833 DEMO_MODE fixture route (`POST /admin/test/valheim/link-fixture`)
 * ROK-1836's armory character fixture (`.../armory-character`) and
 * ROK-1837's map fixture (`.../map-fixture`) and ROK-1853's containers
 * fixture (`.../armory/seed-containers`) and ROK-1854's recipes fixture
 * (`.../recipes-fixture`).
 * Its own module so the demo wiring stays out of `ValheimModule`'s provider
 * list. PelicanConfigService is not exported by PelicanModule; it is
 * stateless (settings + client factory), so a local instance is safe.
 */
@Module({
  imports: [SettingsModule, PelicanModule],
  controllers: [
    ValheimLinkDemoSeedController,
    ValheimArmoryDemoSeedController,
    ValheimArmoryMapDemoSeedController,
    ValheimArmoryContainersDemoSeedController,
    ValheimArmoryRecipesDemoSeedController,
  ],
  providers: [
    PelicanConfigService,
    ValheimLinkTokensRepository,
    ValheimLinkTokensService,
  ],
})
export class ValheimLinkDemoSeedModule {}
