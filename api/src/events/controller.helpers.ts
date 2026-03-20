import type { UserRole } from '@raid-ledger/contract';

// Re-export from canonical locations for backward compatibility
export type { AuthenticatedRequest } from '../auth/types';
export { handleValidationError } from '../common/validation.util';

export function isOperatorOrAdmin(role: UserRole): boolean {
  return role === 'operator' || role === 'admin';
}
