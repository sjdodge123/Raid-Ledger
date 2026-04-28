import { Injectable, Inject, ForbiddenException } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { SettingsService } from '../settings/settings.service';
import { setAutoNominateSteamUrlsPref } from '../discord-bot/listeners/steam-link-interest.helpers';
import {
  createBuildingLineupForTest,
  nominateGameForTest,
  archiveLineupForTest,
  archiveActiveLineupForTest,
  resetLineupsForTest,
} from './demo-test-lineup.helpers';

/**
 * DEMO_MODE-only lineup test service (ROK-1081).
 * Split from DemoTestService to stay under the 300-line file limit.
 */
@Injectable()
export class DemoTestLineupService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly settingsService: SettingsService,
  ) {}

  private async assertDemoMode(): Promise<void> {
    if (process.env.DEMO_MODE !== 'true') {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
    const demoMode = await this.settingsService.getDemoMode();
    if (!demoMode) {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
  }

  async setAutoNominatePrefForTest(
    userId: number,
    enabled: boolean,
  ): Promise<void> {
    await this.assertDemoMode();
    await setAutoNominateSteamUrlsPref(this.db, userId, enabled);
  }

  async createBuildingLineupForTest(
    createdByUserId: number,
  ): Promise<{ lineupId: number }> {
    await this.assertDemoMode();
    return createBuildingLineupForTest(this.db, createdByUserId);
  }

  async nominateGameForTest(
    lineupId: number,
    gameId: number,
    userId: number,
  ): Promise<void> {
    await this.assertDemoMode();
    await nominateGameForTest(this.db, lineupId, gameId, userId);
  }

  async archiveLineupForTest(lineupId: number): Promise<void> {
    await this.assertDemoMode();
    await archiveLineupForTest(this.db, lineupId);
  }

  async archiveActiveLineupForTest(): Promise<void> {
    await this.assertDemoMode();
    await archiveActiveLineupForTest(this.db);
  }

  async resetLineupsForTest(
    titlePrefix: string,
  ): Promise<{ archivedCount: number }> {
    await this.assertDemoMode();
    return resetLineupsForTest(this.db, titlePrefix);
  }
}
