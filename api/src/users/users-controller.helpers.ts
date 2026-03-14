/**
 * Helper functions for UsersController.
 * Extracted from users.controller.ts for file size compliance (ROK-711).
 */
import { BadRequestException } from '@nestjs/common';
import { ZodError, type ZodSchema } from 'zod';

/**
 * Parse a body against a Zod schema, throwing BadRequestException on failure.
 * Reduces repeated try/catch Zod validation in controller methods.
 */
export function parseOrBadRequest<T>(schema: ZodSchema<T>, body: unknown): T {
  try {
    return schema.parse(body);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: error.issues.map((e) => `${e.path.join('.')}: ${e.message}`),
      });
    }
    throw error;
  }
}

/** Validate the optional `source` query param against HEART_SOURCES. */
export function validateSource(
  source: string | undefined,
  allowedSources: string[],
): void {
  if (source && !allowedSources.includes(source)) {
    throw new BadRequestException(
      `Invalid source. Must be one of: ${allowedSources.join(', ')}`,
    );
  }
}

/** Parse pagination query params with safe defaults. */
export function parsePagination(
  pageStr?: string,
  limitStr?: string,
): { page: number; limit: number } {
  const page = Math.max(1, parseInt(pageStr ?? '1', 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(limitStr ?? '20', 10) || 20));
  return { page, limit };
}

/** Resolve week start date from query param or current week. */
export function resolveWeekStart(week?: string): Date {
  if (week) {
    const d = new Date(week);
    if (isNaN(d.getTime()))
      throw new BadRequestException('Invalid week parameter');
    return d;
  }
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);
  return weekStart;
}
