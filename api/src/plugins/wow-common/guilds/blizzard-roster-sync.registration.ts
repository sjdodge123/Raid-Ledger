/**
 * ROK-1928 — the Forever Blizzard roster sync's Nest classes, spread into
 * `WowCommonModule` (keeps that module under the 300-line limit).
 */
import { BlizzardRosterSyncJob } from './blizzard-roster-sync.job';
import { BlizzardRosterSyncService } from './blizzard-roster-sync.service';
import { GuildBlizzardRosterSyncController } from './guild-blizzard-roster-sync.controller';

/** Sync service (part B) + cron/manual job (part C). */
export const PROVIDERS = [BlizzardRosterSyncService, BlizzardRosterSyncJob];

/** `POST …/blizzard-roster/sync`. */
export const CONTROLLERS = [GuildBlizzardRosterSyncController];
