/**
 * Game-registry controller — `GET /games/configured` (ROK-1407).
 *
 * Split out of `igdb.controller.ts`, which sits at the 300-line ESLint cap
 * and cannot absorb the `Cache-Control` header this route now carries.
 * Registered BEFORE `IgdbController` in `igdb.module.ts` so the literal
 * `configured` segment is matched ahead of that controller's `:id` family.
 */
import { Controller, Get, Header } from '@nestjs/common';
import type { GameRegistryListResponseDto } from '@raid-ledger/contract';
import { IgdbService } from './igdb.service';
import { listConfiguredGames } from './igdb-registry.helpers';

/**
 * `private`, never `public`: the route is unauthenticated but the web client
 * always sends `Authorization` + `credentials: 'include'`, so a shared cache
 * must never store this response. The 5-minute freshness window sits under
 * react-query's own 10-minute `staleTime`, and `stale-while-revalidate` lets
 * a stale copy render while the (now 304-able) revalidation runs.
 */
const REGISTRY_CACHE_CONTROL =
  'private, max-age=300, stale-while-revalidate=3600';

/** Controller for the game registry / config projection. */
@Controller('games')
export class GamesRegistryController {
  constructor(private readonly igdbService: IgdbService) {}

  /** GET /games/configured -- Returns enabled games with config columns. */
  @Get('configured')
  @Header('Cache-Control', REGISTRY_CACHE_CONTROL)
  async getConfiguredGames(): Promise<GameRegistryListResponseDto> {
    return listConfiguredGames(this.igdbService.database);
  }
}
