import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@raid-ledger/contract';

export const ROLES_KEY = 'roles';

/**
 * Decorator that specifies the minimum role required to access an endpoint.
 * Role hierarchy: admin > operator > member
 *
 * @Roles('operator') allows operator + admin
 * @Roles('admin') allows admin only
 *
 * Usage:
 *   @UseGuards(AuthGuard('jwt'), RolesGuard)
 *   @Roles('operator')
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
