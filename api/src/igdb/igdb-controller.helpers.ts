import {
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ZodError } from 'zod';

/**
 * Handle errors from the game search endpoint.
 * Re-throws as appropriate NestJS HTTP exceptions.
 * @param error - The caught error
 * @param logger - Logger instance for IGDB errors
 * @throws BadRequestException for Zod validation failures
 * @throws InternalServerErrorException for IGDB API errors
 */
export function handleSearchError(error: unknown, logger: Logger): never {
  if (error instanceof Error && error.name === 'ZodError') {
    const messages = (error as ZodError).issues.map(
      (e) => `${e.path.join('.')}: ${e.message}`,
    );
    throw new BadRequestException({
      message: 'Validation failed',
      errors: messages,
    });
  }
  if (error instanceof Error && error.message.includes('IGDB')) {
    logger.error(`IGDB API error: ${error.message}`);
    throw new InternalServerErrorException(
      'Game search service temporarily unavailable',
    );
  }
  throw error;
}
