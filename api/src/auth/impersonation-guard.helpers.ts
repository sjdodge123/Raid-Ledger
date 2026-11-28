/**
 * ROK-2376: an impersonation session must never add or remove a sign-in
 * method on the account it is impersonating. A provider linked there would
 * outlive the impersonation and let the impersonator keep signing in as the
 * target. Called on every route that changes a sign-in method; the link
 * callbacks carry no session, so refusing the start (the only place a link
 * nonce is minted) closes them too.
 */
import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from './types';

export const IMPERSONATION_SIGNIN_METHODS_MESSAGE =
  'Cannot change sign-in methods while impersonating';

/** 403 when the session is an impersonation (`impersonatedBy` set). */
export function assertNotImpersonating(
  user: Pick<AuthenticatedUser, 'impersonatedBy'>,
): void {
  if (user.impersonatedBy) {
    throw new ForbiddenException(IMPERSONATION_SIGNIN_METHODS_MESSAGE);
  }
}
