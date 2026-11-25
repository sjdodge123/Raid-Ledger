import { HttpException } from '@nestjs/common';
import type { HubError, HubErrorCode } from '@raid-ledger/contract';

/**
 * An error whose body is already a `HubErrorSchema` value (L7, ROK-1671).
 * {@link HubExceptionFilter} sends its body as-is.
 */
export class HubHttpException extends HttpException {
  constructor(
    status: number,
    readonly body: HubError,
  ) {
    super(body, status);
  }
}

/** `hubError(403, 'revoked')` → 403 `{error: 'revoked'}`. */
export function hubError(
  status: number,
  code: HubErrorCode,
  message?: string,
): HubHttpException {
  const body: HubError =
    message === undefined ? { error: code } : { error: code, message };
  return new HubHttpException(status, body);
}
