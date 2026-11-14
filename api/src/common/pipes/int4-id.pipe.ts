import { BadRequestException, type PipeTransform } from '@nestjs/common';
import { z } from 'zod';

/** Largest Postgres `integer` (int4) — the range of every `serial` id. */
export const INT4_MAX = 2147483647;

const Int4IdSchema = z.coerce.number().int().min(1).max(INT4_MAX);

/**
 * Backlog 2026-10-12 — path-id pipe for `serial` ids: a positive int4, else
 * 400. `ParseIntPipe` let ids above int4 reach Postgres (22003 → 500). Same
 * rule as the plugin-owned `Bg3IdPipe` / `ArmoryIdPipe`, for core routes.
 */
export class Int4IdPipe implements PipeTransform<unknown, number> {
  /** Parse `value` as a positive int4 id or throw 400. */
  transform(value: unknown): number {
    const parsed = Int4IdSchema.safeParse(value);
    if (!parsed.success) throw new BadRequestException('Invalid id');
    return parsed.data;
  }
}

/** Shared instance for `@Param('id', int4IdPipe)`. */
export const int4IdPipe = new Int4IdPipe();
