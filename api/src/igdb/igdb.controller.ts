import {
  Controller,
  Get,
  Query,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { IgdbService } from './igdb.service';
import {
  GameSearchQuerySchema,
  GameSearchResponseDto,
} from '@raid-ledger/contract';
import { ZodError } from 'zod';

/**
 * Controller for IGDB game discovery endpoints.
 * Provides game search functionality with local caching.
 */
@Controller('games')
export class IgdbController {
  private readonly logger = new Logger(IgdbController.name);

  constructor(private readonly igdbService: IgdbService) {}

  /**
   * Search for games by name.
   * @param query - Search query string (min 1 char, max 100 chars)
   * @returns Search results with cache status
   * @throws BadRequestException if query validation fails
   * @throws InternalServerErrorException if IGDB API fails
   */
  @Get('search')
  async searchGames(@Query('q') query: string): Promise<GameSearchResponseDto> {
    try {
      // Validate query with Zod
      const validated = GameSearchQuerySchema.parse({ q: query });

      const result = await this.igdbService.searchGames(validated.q);

      return {
        data: result.games,
        meta: {
          total: result.games.length,
          cached: result.cached,
        },
      };
    } catch (error) {
      // Handle Zod validation errors (check by name due to potential multiple zod instances)
      if (error instanceof Error && error.name === 'ZodError') {
        const zodError = error as ZodError;
        const messages = zodError.issues.map(
          (e) => `${e.path.join('.')}: ${e.message}`,
        );
        throw new BadRequestException({
          message: 'Validation failed',
          errors: messages,
        });
      }

      // Handle IGDB API errors
      if (error instanceof Error && error.message.includes('IGDB')) {
        this.logger.error(`IGDB API error: ${error.message}`);
        throw new InternalServerErrorException(
          'Game search service temporarily unavailable',
        );
      }

      // Re-throw unexpected errors
      throw error;
    }
  }
}
