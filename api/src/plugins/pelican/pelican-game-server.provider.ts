import { Injectable } from '@nestjs/common';
import type {
  GameServerCalendarItemDto,
  GameServerStatusDto,
} from '@raid-ledger/contract';
import type { GameServerProvider } from '../plugin-host/extension-points';
import { PELICAN_PLUGIN_ID, PELICAN_PROVIDER_LABEL } from './pelican.constants';
import { PelicanServersRepository } from './pelican-servers.repository';
import { toStatusDto } from './pelican-state.helpers';

/**
 * Pelican's `GameServerProvider` (ROK-1772, ruling Q2). Every DTO is
 * member-safe: `serverKey` is the opaque DB id and `serverName` is redacted
 * (Q3). Calendar items stay empty until S5 (ROK-1096) — D12.
 */
@Injectable()
export class PelicanGameServerProvider implements GameServerProvider {
  readonly pluginSlug = PELICAN_PLUGIN_ID;
  readonly providerLabel = PELICAN_PROVIDER_LABEL;

  constructor(private readonly repo: PelicanServersRepository) {}

  getCalendarItems(): Promise<GameServerCalendarItemDto[]> {
    return Promise.resolve([]);
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
}
