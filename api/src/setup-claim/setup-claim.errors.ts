/**
 * ROK-1701: the claim endpoint's distinct error responses. Body shape is the
 * contract's `SetupClaimErrorSchema` (`{ code, message, retryAt? }`). None of
 * them ever carries the code or says anything about the admin account.
 */
import { HttpException, HttpStatus } from '@nestjs/common';
import type { SetupClaimErrorCode } from '@raid-ledger/contract';

const CLAIM_ERRORS: Record<
  SetupClaimErrorCode,
  { status: HttpStatus; message: string }
> = {
  claim_code_invalid: {
    status: HttpStatus.UNAUTHORIZED,
    message:
      "That code doesn't match. Copy it again from your host; a character is easy to miss.",
  },
  claim_expired: {
    status: HttpStatus.GONE,
    message: 'This code has expired — restart the service for a new code.',
  },
  claim_locked: {
    status: HttpStatus.TOO_MANY_REQUESTS,
    message: 'Too many wrong codes. Claiming is paused for 15 minutes.',
  },
  claim_https_required: {
    status: HttpStatus.FORBIDDEN,
    message: 'Open this page over https:// to claim it.',
  },
  claim_not_available: {
    status: HttpStatus.CONFLICT,
    message: 'This Raid Ledger is not waiting to be claimed.',
  },
};

export class SetupClaimException extends HttpException {
  constructor(
    readonly claimCode: SetupClaimErrorCode,
    readonly retryAt: Date | null = null,
  ) {
    const { status, message } = CLAIM_ERRORS[claimCode];
    super(
      {
        code: claimCode,
        message,
        ...(retryAt ? { retryAt: retryAt.toISOString() } : {}),
      },
      status,
    );
  }
}

/** Whole seconds until `retryAt` (≥ 1), for the `Retry-After` header. */
export function retryAfterSeconds(retryAt: Date, now: Date): number {
  return Math.max(1, Math.ceil((retryAt.getTime() - now.getTime()) / 1000));
}
