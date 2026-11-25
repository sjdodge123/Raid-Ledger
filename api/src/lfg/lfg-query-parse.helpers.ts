/** ROK-2352 — parse an LFG route's query string against a contract schema. */
import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';

/**
 * Parse `query` with `schema`, or 400 with the offending fields.
 *
 * @param schema - The contract query schema.
 * @param query - The raw `@Query()` object.
 */
export function parseQuery<S extends z.ZodTypeAny>(
  schema: S,
  query: unknown,
): z.infer<S> {
  const parsed = schema.safeParse(query);
  if (!parsed.success) {
    throw new BadRequestException(parsed.error.flatten().fieldErrors);
  }
  return parsed.data;
}
