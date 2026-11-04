/**
 * ROK-1966 Q3 — the `/config` hub picker for `bg3-screenshot`: every BG3
 * hub the caller is a live member of; the default is the hub of the
 * campaign their most recent save is filed under, else the first.
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  COMPANION_CONFIG_HUB_TARGETS_MAX,
  type CompanionConfigHubTarget,
} from '@raid-ledger/contract';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import type * as schema from '../../../drizzle/schema';
import { latestSaveHubId, memberBg3Hubs } from './bg3-screenshot.repository';

/** Pure: mark `preferred` (when listed) or the first hub as the default. */
export function toHubTargets(
  hubs: readonly { guildId: number; name: string }[],
  preferred: number | null,
): CompanionConfigHubTarget[] {
  const listed = hubs.slice(0, COMPANION_CONFIG_HUB_TARGETS_MAX);
  const pick = listed.some((h) => h.guildId === preferred)
    ? preferred
    : (listed[0]?.guildId ?? null);
  return listed.map((h) => ({
    hubGuildId: h.guildId,
    name: h.name,
    isDefault: h.guildId === pick,
  }));
}

@Injectable()
export class Bg3ScreenshotTargets {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async forUser(userId: number): Promise<CompanionConfigHubTarget[]> {
    const hubs = await memberBg3Hubs(this.db, userId);
    if (hubs.length === 0) return [];
    return toHubTargets(hubs, await latestSaveHubId(this.db, userId));
  }
}
