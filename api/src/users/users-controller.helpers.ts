/**
 * Helper functions for UsersController.
 * Extracted from users.controller.ts for file size compliance (ROK-711).
 */
import { BadRequestException } from '@nestjs/common';
import { ZodError, type ZodSchema } from 'zod';
import {
  GameInterestSourceValues,
  PlayHistoryFilterSchema,
} from '@raid-ledger/contract';

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

/**
 * Parse comma-separated sources string, validating each against GameInterestSourceValues.
 * Invalid values are silently dropped.
 */
export function parseSources(sourcesStr?: string): string[] {
  if (!sourcesStr?.trim()) return [];
  const allowed = new Set<string>(GameInterestSourceValues);
  return sourcesStr
    .split(',')
    .map((s) => s.trim())
    .filter((s) => allowed.has(s));
}

/**
 * Parse playtimeMin query param to a positive integer, or undefined.
 * Returns undefined for zero, negative, or non-numeric values.
 */
export function parsePlaytimeMin(str?: string): number | undefined {
  if (!str?.trim()) return undefined;
  const n = Math.floor(Number(str));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Parse playHistory query param against PlayHistoryFilterSchema.
 * Returns the value if valid, undefined otherwise.
 */
export function parsePlayHistory(str?: string): string | undefined {
  if (!str?.trim()) return undefined;
  const result = PlayHistoryFilterSchema.safeParse(str);
  return result.success ? result.data : undefined;
}

/**
 * Merge legacy single-source param with new multi-source param.
 * Backward compat: if old `source` param sent, treat as `sources=[value]`.
 */
export function resolveSources(source?: string, sourcesStr?: string): string[] {
  if (sourcesStr) return parseSources(sourcesStr);
  if (source) return parseSources(source);
  return [];
}

/** Build paginated meta object for list responses. */
export function buildPaginatedMeta(
  total: number,
  page: number,
  limit: number,
): { total: number; page: number; limit: number; hasMore: boolean } {
  return { total, page, limit, hasMore: page * limit < total };
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
