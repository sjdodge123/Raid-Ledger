import { Module } from '@nestjs/common';
import { GuildsCoreModule } from '../../../../guilds/guilds-core.module';
import { SettingsModule } from '../../../../settings/settings.module';
import { WowFactsModule } from '../../facts/wow-facts.module';
import { InstanceCatalogueService } from '../../instance-catalogue/instance-catalogue.service';
import { SuggestedGroupsService } from './suggested-groups.service';

/**
 * ROK-2212 — Suggested groups read (blizzard plugin). A sub-module so
 * `WowCommonModule` stays under the line cap; the catalogue wrapper is
 * stateless, so it is provided here too rather than importing the parent.
 */
@Module({
  imports: [SettingsModule, GuildsCoreModule, WowFactsModule],
  providers: [SuggestedGroupsService, InstanceCatalogueService],
  exports: [SuggestedGroupsService],
})
export class SuggestedGroupsModule {}
