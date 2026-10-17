import { BadRequestException } from '@nestjs/common';
import { ZodError } from 'zod';

/**
 * Handle Zod validation errors by converting to BadRequestException.
 * Rethrows non-Zod errors as-is.
 */
export function handleValidationError(error: unknown): never {
  if (error instanceof Error && error.name === 'ZodError') {
    const zodError = error as ZodError;
    throw new BadRequestException({
      message: 'Validation failed',
      errors: zodError.issues.map((e) => `${e.path.join('.')}: ${e.message}`),
    });
  }
  throw error;
}
