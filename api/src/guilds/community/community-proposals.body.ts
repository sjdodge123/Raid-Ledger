import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';

/** House idiom: `safeParse` → 400 with the flattened field errors. */
export function parseBody<S extends z.ZodType>(
  schema: S,
  body: unknown,
): z.infer<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException(parsed.error.flatten().fieldErrors);
  }
  return parsed.data;
}
