import { BadRequestException } from '@nestjs/common';
import { ZodError } from 'zod';
import type { UserRole } from '@raid-ledger/contract';

export interface AuthenticatedRequest {
  user: {
    id: number;
    role: UserRole;
  };
}

export function isOperatorOrAdmin(role: UserRole): boolean {
  return role === 'operator' || role === 'admin';
}

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
