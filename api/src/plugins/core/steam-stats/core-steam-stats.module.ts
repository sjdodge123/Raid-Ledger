import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CronJobModule } from '../../../cron-jobs/cron-job.module';
import { GuildsCoreModule } from '../../../guilds/guilds-core.module';
import { SettingsModule } from '../../../settings/settings.module';
import {
  MAX_USER_FETCHES_PER_RUN,
  STEAM_APP_STATS_QUEUE,
  STEAM_STATS_RUN_LIMITS,
  USER_DELAY_MS,
  type SteamStatsRunLimits,
} from './steam-stats.constants';
import { SteamStatsController } from './steam-stats.controller';
import { SteamStatsReadRepository } from './steam-stats-read.repository';
import { SteamStatsReadService } from './steam-stats-read.service';
import { SteamStatsLinkListener } from './steam-stats-link.listener';
import { SteamStatsRefreshService } from './steam-stats-refresh.service';
import { SteamStatsStorageRepository } from './steam-stats-storage.repository';
import { SteamStatsTargetsRepository } from './steam-stats-targets.repository';
import { SteamAppStatsProcessor } from './steam-stats.processor';

const LIMITS: SteamStatsRunLimits = {
  delayMs: USER_DELAY_MS,
  maxUserFetches: MAX_USER_FETCHES_PER_RUN,
};

/**
 * ROK-1953 D4 — Core's shared Steam achievements + playtime cards: storage,
 * the nightly/on-link refresh and the members-only read route. Imported by `CorePluginModule`; lives under
 * `plugins/core/` so the ROK-1969 ownership guard sees the cron as Core's.
 */
@Module({
  imports: [
    GuildsCoreModule,
    SettingsModule,
    CronJobModule,
    BullModule.registerQueue({ name: STEAM_APP_STATS_QUEUE }),
  ],
  controllers: [SteamStatsController],
  providers: [
    { provide: STEAM_STATS_RUN_LIMITS, useValue: LIMITS },
    SteamStatsTargetsRepository,
    SteamStatsStorageRepository,
    SteamStatsRefreshService,
    SteamAppStatsProcessor,
    SteamStatsLinkListener,
    SteamStatsReadRepository,
    SteamStatsReadService,
  ],
  exports: [SteamStatsStorageRepository],
})
export class CoreSteamStatsModule {}
