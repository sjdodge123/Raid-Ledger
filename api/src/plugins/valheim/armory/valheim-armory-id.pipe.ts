import { BadRequestException, type PipeTransform } from '@nestjs/common';
import { z } from 'zod';

/** Largest Postgres `integer` (int4) — armory ids are `serial`. */
const INT4_MAX = 2147483647;

const ArmoryIdSchema = z.coerce.number().int().min(1).max(INT4_MAX);

/**
 * ROK-1835 path-id pipe for the armory routes: a positive int4, else 400.
 * `ParseIntPipe` let `0`/negatives through (→ 404) and ids above int4 reach
 * Postgres (22003 → 500).
 */
export class ArmoryIdPipe implements PipeTransform<unknown, number> {
  /** Parse `value` as an armory id or throw 400. */
  transform(value: unknown): number {
    const parsed = ArmoryIdSchema.safeParse(value);
    if (!parsed.success) throw new BadRequestException('Invalid id');
    return parsed.data;
  }
}

/** Shared instance for `@Param('id', armoryIdPipe)`. */
export const armoryIdPipe = new ArmoryIdPipe();
