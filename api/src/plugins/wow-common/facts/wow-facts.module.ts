import { Module } from '@nestjs/common';
import { SettingsModule } from '../../../settings/settings.module';
import { RosterFactSource } from './roster.fact-source';
import { AddonSnapshotFactSource } from './addon-snapshot.fact-source';
import { CharacterRowFactSource } from './character-row.fact-source';
import { BlizzardForeverFactSource } from './blizzard-forever.fact-source';
import { WowFactsService } from './wow-facts.service';

/**
 * ROK-1910: roster fact sources + the precedence resolver (H5 roster-insights
 * injects WowFactsService). ROK-1920 adds the Armory-synced Forever source.
 * Split out of WowCommonModule (ROK-2100) to keep that file under the cap;
 * WowCommonModule imports and re-exports it. DrizzleModule is global.
 */
@Module({
  imports: [SettingsModule],
  providers: [
    RosterFactSource,
    AddonSnapshotFactSource,
    CharacterRowFactSource,
    BlizzardForeverFactSource,
    WowFactsService,
  ],
  exports: [WowFactsService],
})
export class WowFactsModule {}
