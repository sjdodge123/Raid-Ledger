import type { Request } from 'express';
import type { UserRole } from '@raid-ledger/contract';

/**
 * Shape of `req.user` after JWT authentication.
 * Matches the object returned by JwtStrategy.validate().
 */
export interface AuthenticatedUser {
  id: number;
  username: string;
  role: UserRole;
  discordId: string | null;
  impersonatedBy: number | null;
}

/**
 * Lightweight request type for controllers that only need `req.user`.
 * Use this when you don't need Express Request methods (headers, cookies, etc.).
 */
export interface AuthenticatedRequest {
  user: AuthenticatedUser;
}

/**
 * Full Express Request with authenticated user attached.
 * Use this when you need Express methods (e.g., req.headers, req.protocol).
 */
export interface AuthenticatedExpressRequest extends Request {
  user: AuthenticatedUser;
}
