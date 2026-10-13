import { Injectable, Logger } from '@nestjs/common';
import {
  GameServerCalendarItemSchema,
  GameServerCalendarResponseSchema,
  GameServerStatusResponseSchema,
  GameServerStatusSchema,
  type GameServerCalendarQueryDto,
  type GameServerCalendarResponseDto,
  type GameServerStatusResponseDto,
} from '@raid-ledger/contract';
import { PluginRegistryService } from './plugin-registry.service';
import {
  EXTENSION_POINTS,
  GAME_SERVER_PROVIDER_KEY,
  type GameServerProvider,
} from './extension-points';
import {
  compareCalendarItems,
  compareStatuses,
  keepCalendarItem,
  keepStatus,
  settleProvider,
} from './game-server-calendar.helpers';

/**
 * Aggregates every ACTIVE `GameServerProvider` into one calendar / status
 * feed (ROK-268). A provider that throws, times out or returns invalid data is
 * logged and skipped; the others are still returned.
 */
@Injectable()
export class GameServerCalendarService {
  private readonly logger = new Logger(GameServerCalendarService.name);

  constructor(private readonly registry: PluginRegistryService) {}

  /** Registered providers whose owning plugin is active (defence in depth). */
  private activeProviders(): GameServerProvider[] {
    return this.registry
      .getMultiAdapters<GameServerProvider>(
        EXTENSION_POINTS.GAME_SERVER_PROVIDER,
        GAME_SERVER_PROVIDER_KEY,
      )
      .filter((p) => this.registry.isActive(p.pluginSlug));
  }

  async getCalendarItems(
    query: GameServerCalendarQueryDto,
  ): Promise<GameServerCalendarResponseDto> {
    const range = { from: new Date(query.from), to: new Date(query.to) };
    const { gameIds } = query;
    const perProvider = await Promise.all(
      this.activeProviders().map((p) =>
        settleProvider(
          {
            pluginSlug: p.pluginSlug,
            providerLabel: p.providerLabel,
            call: () => p.getCalendarItems(range, gameIds),
          },
          GameServerCalendarItemSchema,
          this.logger,
        ),
      ),
    );
    const data = perProvider
      .flat()
      .filter((item) => keepCalendarItem(item, gameIds))
      .sort(compareCalendarItems);
    return GameServerCalendarResponseSchema.parse({ data });
  }

  async getStatuses(gameIds?: number[]): Promise<GameServerStatusResponseDto> {
    const perProvider = await Promise.all(
      this.activeProviders().map((p) =>
        settleProvider(
          {
            pluginSlug: p.pluginSlug,
            providerLabel: p.providerLabel,
            call: () => p.getStatuses(gameIds),
          },
          GameServerStatusSchema,
          this.logger,
        ),
      ),
    );
    const data = perProvider
      .flat()
      .filter((status) => keepStatus(status, gameIds))
      .sort(compareStatuses);
    return GameServerStatusResponseSchema.parse({ data });
  }
}
