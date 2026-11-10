import { HttpException } from '@nestjs/common';
import {
  HUB_CLAIM_ERROR_STATUS,
  type HubClaimErrorCode,
} from '@raid-ledger/contract';

/** ROK-2153 D3: the one error vocabulary claim providers throw. */
export class HubClaimError extends Error {
  constructor(
    readonly code: HubClaimErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'HubClaimError';
  }
}

const REASON: Readonly<Record<number, string>> = {
  400: 'Bad Request',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
};

/** Map a `HubClaimError` to the Nest exception the contract names. */
export function toHttpException(err: HubClaimError): HttpException {
  const statusCode = HUB_CLAIM_ERROR_STATUS[err.code];
  return new HttpException(
    {
      statusCode,
      error: REASON[statusCode] ?? 'Error',
      code: err.code,
      message: err.message,
    },
    statusCode,
  );
}

/** Rethrow a `HubClaimError` as its HTTP exception; anything else unchanged. */
export function rethrowHubClaim(err: unknown): never {
  if (err instanceof HubClaimError) throw toHttpException(err);
  throw err;
}
