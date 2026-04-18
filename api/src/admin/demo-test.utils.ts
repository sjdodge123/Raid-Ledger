import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/** Parse and validate body with a Zod schema, throwing 400 on failure. */
export function parseDemoBody<T>(schema: z.ZodSchema<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const messages = result.error.errors
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join('; ');
    throw new BadRequestException(`Validation failed: ${messages}`);
  }
  return result.data;
}
