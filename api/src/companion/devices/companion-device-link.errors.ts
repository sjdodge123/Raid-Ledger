/**
 * ROK-1955: the device-link error bodies (spec §8). Poll errors use the
 * RFC 8628 §3.5 `{ error }` shape; the rest use `{ code, message }`.
 */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { CompanionLinkPollErrorCode } from '@raid-ledger/contract';

/** 400 `{ error, interval? }` — `interval` only on `slow_down`. */
export function pollError(
  error: CompanionLinkPollErrorCode,
  interval?: number,
): BadRequestException {
  return new BadRequestException({
    error,
    ...(interval === undefined ? {} : { interval }),
  });
}

/** True for the poll's `invalid_grant` (the counted poll failure). */
export function isInvalidGrant(err: unknown): boolean {
  if (!(err instanceof BadRequestException)) return false;
  const body = err.getResponse();
  return (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    body.error === 'invalid_grant'
  );
}

/** One 404 for unknown / expired / not pending / someone else's code. */
export function codeNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'code_not_found',
    message: "That code isn't valid or has expired",
  });
}

/** 409 when the user already has the maximum number of live devices. */
export function deviceLimit(): ConflictException {
  return new ConflictException({
    code: 'device_limit',
    message:
      'You already have the maximum number of linked devices. Remove one from your Devices list first.',
  });
}

/** 409 when one network already has too many links waiting. */
export function tooManyPending(): ConflictException {
  return new ConflictException({
    code: 'too_many_pending',
    message: 'Too many devices are waiting to be linked from this network.',
  });
}
