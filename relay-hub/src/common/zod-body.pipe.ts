import type { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { hubError } from './hub-errors';

/** `instanceId: Invalid UUID; version: Too big` — paths only, never values. */
function summarise(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(body)'}: ${issue.code}`)
    .join('; ');
}

/**
 * Validates a request body with a Zod schema (L7, ROK-1671). Failure is a 400
 * `{error: 'validation_failed', message}` naming the failing paths and issue
 * codes; submitted values are never echoed.
 */
export class ZodBodyPipe<S extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    const parsed = this.schema.safeParse(value);
    if (parsed.success) return parsed.data;
    throw hubError(400, 'validation_failed', summarise(parsed.error));
  }
}
