import { Injectable, Inject, Logger } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { SettingsService } from '../settings/settings.service';
import type {
  DemoDataStatusDto,
  DemoDataResultDto,
  DemoDataCountsDto,
} from '@raid-ledger/contract';
import { createRng } from './demo-data-generator';
import * as coreH from './demo-data-install-core.helpers';
import * as clearH from './demo-data-clear.helpers';
import {
  makeBatchInsert,
  makeBatchInsertReturning,
} from './demo-data-batch.utils';
import * as orchH from './demo-data-install-orchestrate.helpers';
import { TasteProfileService } from '../taste-profile/taste-profile.service';
import { CommunityInsightsService } from '../community-insights/community-insights.service';

@Injectable()
export class DemoDataService {
  private readonly logger = new Logger(DemoDataService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly settingsService: SettingsService,
    private readonly tasteProfileService: TasteProfileService,
    private readonly communityInsightsService: CommunityInsightsService,
  ) {}

  async getStatus(): Promise<DemoDataStatusDto> {
    const demoMode = await this.settingsService.getDemoMode();
    const counts = await clearH.getCounts(this.db);
    return { demoMode, ...counts };
  }

  async installDemoData(): Promise<DemoDataResultDto> {
    const existing = await clearH.getCounts(this.db);
    if (existing.users > 0) {
      return {
        success: false,
        message:
          'Demo data already exists. Delete it first before reinstalling.',
        counts: existing,
      };
    }
    this.logger.log('Installing demo data (~100 users)...');
    try {
      const counts = await this.performInstall();
      this.logger.log('Demo data installed');
      this.logger.debug(`Demo data counts: ${JSON.stringify(counts)}`);
      return this.buildInstallResult(true, counts);
    } catch (error) {
      this.logger.error('Failed to install demo data:', error);
      try {
        await this.clearDemoData();
      } catch {
        /* Best-effort */
      }
      return this.buildInstallResult(false, clearH.emptyCounts(), error);
    }
  }

  async clearDemoData(): Promise<DemoDataResultDto> {
    this.logger.log('Clearing demo data...');
    try {
      const countsBefore = await clearH.getCounts(this.db);
      await clearH.performClear(this.db, this.settingsService);
      this.logger.log('Demo data cleared');
      return {
        success: true,
        message: `Demo data deleted: ${countsBefore.users} users, ${countsBefore.events} events removed`,
        counts: countsBefore,
      };
    } catch (error) {
      this.logger.error('Failed to clear demo data:', error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : 'Failed to clear demo data',
        counts: clearH.emptyCounts(),
      };
    }
  }

  private buildInstallResult(
    success: boolean,
    counts: DemoDataCountsDto,
    error?: unknown,
  ): DemoDataResultDto {
    const message = success
      ? `Demo data installed: ${counts.users} users, ${counts.events} events, ${counts.characters} characters`
      : error instanceof Error
        ? error.message
        : 'Failed to install demo data';
    return { success, message, counts };
  }

  private async performInstall(): Promise<DemoDataCountsDto> {
    const rng = createRng();
    const now = new Date();
    const batchInsert = makeBatchInsert(this.db);
    const batchInsertReturning = makeBatchInsertReturning(this.db);

    const { allUsers, userByName } = await coreH.installUsers(
      batchInsertReturning,
      this.db,
    );
    const allGames = await this.db.select().from(schema.games);
    const gen = coreH.generateAllData(rng, allGames, now);

    const core = await orchH.installCoreEntities(
      this.db,
      batchInsert,
      batchInsertReturning,
      allUsers,
      userByName,
      allGames,
      gen,
    );
    const secondary = await orchH.installSecondaryEntities(
      this.db,
      batchInsert,
      allUsers,
      userByName,
      allGames,
      gen,
    );
    await this.settingsService.setDemoMode(true);
    await orchH.runTasteProfileAggregation(
      this.db,
      this.tasteProfileService,
      this.communityInsightsService,
      this.logger,
    );

    return { users: allUsers.length, ...core, ...secondary };
  }
}
