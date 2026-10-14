import { Injectable, Logger } from '@nestjs/common';
import { GameServerCalendarItemSchema } from '@raid-ledger/contract';
import type {
  GameServerCalendarItemDto,
  GameServerStatusDto,
} from '@raid-ledger/contract';
import type { GameServerProvider } from '../plugin-host/extension-points';
import { PELICAN_PLUGIN_ID, PELICAN_PROVIDER_LABEL } from './pelican.constants';
import { PelicanConfigService } from './pelican-config.service';
import {
  projectSchedules,
  type ProjectionResult,
} from './pelican-projection.helpers';
import { PelicanSchedulesRepository } from './pelican-schedules.repository';
import { PelicanServersRepository } from './pelican-servers.repository';
import { toStatusDto } from './pelican-state.helpers';

/**
 * Pelican's `GameServerProvider` (ROK-1772, ruling Q2). Every DTO is
 * member-safe: `serverKey` is the opaque DB id and `serverName` is redacted
 * (Q3). Calendar items are the stored schedules projected into windows and
 * markers (ROK-1096) — no uuids, addresses or command payloads.
 */
@Injectable()
export class PelicanGameServerProvider implements GameServerProvider {
  readonly pluginSlug = PELICAN_PLUGIN_ID;
  readonly providerLabel = PELICAN_PROVIDER_LABEL;
  private readonly logger = new Logger(PelicanGameServerProvider.name);

  constructor(
    private readonly repo: PelicanServersRepository,
    private readonly schedules: PelicanSchedulesRepository,
    private readonly config: PelicanConfigService,
  ) {}

  /** Windows + markers overlapping `[from, to)` for servable servers (D14). */
  async getCalendarItems(
    range: { from: Date; to: Date },
    gameIds?: number[],
  ): Promise<GameServerCalendarItemDto[]> {
    const [schedules, defaultTimezone] = await Promise.all([
      this.schedules.listServable(gameIds),
      this.config.resolveDefaultTimezone(),
    ]);
    const result = projectSchedules({
      schedules,
      defaultTimezone,
      range,
      ...(gameIds !== undefined ? { gameIds } : {}),
    });
    this.logProjection(result);
    return result.items.map((item) => GameServerCalendarItemSchema.parse(item));
  }

  /** Polled servers that have been checked at least once; never-checked are omitted. */
  async getStatuses(gameIds?: number[]): Promise<GameServerStatusDto[]> {
    const rows = await this.repo.listPollable();
    const wanted = gameIds === undefined ? null : new Set(gameIds);
    const now = new Date();
    const out: GameServerStatusDto[] = [];
    for (const row of rows) {
      if (wanted && (row.gameId === null || !wanted.has(row.gameId))) continue;
      const dto = toStatusDto(row, now);
      if (dto) out.push(dto);
    }
    return out;
  }

  /** Ids only — never names, crons or panel payloads. */
  private logProjection(result: ProjectionResult): void {
    const { truncatedServerIds, tzMismatchServerIds, skipped } = result;
    if (truncatedServerIds.length > 0) {
      this.logger.warn(
        `Pelican projection truncated servers: ${truncatedServerIds.join(', ')}`,
      );
    }
    if (tzMismatchServerIds.length > 0) {
      this.logger.warn(
        `Pelican tz mismatch servers: ${tzMismatchServerIds.join(', ')}`,
      );
    }
    for (const s of skipped) {
      const schedule = s.scheduleId !== undefined ? ` schedule ${s.scheduleId}` : '';
      this.logger.warn(
        `Pelican projection skipped server ${s.serverId}${schedule}: ${s.reason}`,
      );
    }
  }
}
