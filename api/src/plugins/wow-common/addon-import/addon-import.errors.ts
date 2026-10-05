import { HttpException, HttpStatus } from '@nestjs/common';
import type {
  AddonImportAddCharacterPrefill,
  AddonImportErrorBody,
  AddonImportErrorCode,
} from '@raid-ledger/contract';

/**
 * Default user-facing copy per code. Messages NEVER echo any part of the
 * pasted string or its decoded payload (ROK-1724 security rule).
 */
const DEFAULT_MESSAGES: Record<AddonImportErrorCode, string> = {
  TOO_LARGE: 'That import string is too large.',
  BAD_HEADER: "That doesn't look like a Raid Ledger import string.",
  UNSUPPORTED_VERSION: 'That import string comes from an unsupported addon version.',
  CUT_OFF: 'The string looks cut off — copy it again.',
  DECODED_TOO_LARGE: 'That import string expands to more data than allowed.',
  INVALID_PAYLOAD: "The import string's contents are not in the expected format.",
  PAGES_INCOMPLETE: 'Some pages of this export are missing or duplicated — paste every page once.',
  WRONG_GAME: 'This character is not a WoW: Forever character.',
  REGION_MISMATCH: "The export's region does not match this character.",
  NAME_MISMATCH: 'The export is from a different character.',
  NOT_IN_GUILD: 'The exporting character is not in that guild roster.',
  GUID_CONFIRM_REQUIRED: 'The in-game character changed — confirm to re-link it.',
  RATE_LIMITED: 'Too many imports — try again later.',
};

/** 413 `TOO_LARGE`, 429 `RATE_LIMITED`, everything else 422 (contract). */
export function addonImportStatus(code: AddonImportErrorCode): number {
  if (code === 'TOO_LARGE') return HttpStatus.PAYLOAD_TOO_LARGE;
  if (code === 'RATE_LIMITED') return HttpStatus.TOO_MANY_REQUESTS;
  return HttpStatus.UNPROCESSABLE_ENTITY;
}

export interface AddonImportErrorExtra {
  addCharacter?: AddonImportAddCharacterPrefill;
}

/**
 * Import failure. The global exception filter sends `getResponse()` as the
 * JSON body, so the wire shape is exactly `AddonImportErrorBody`.
 */
export class AddonImportError extends HttpException {
  readonly code: AddonImportErrorCode;

  constructor(
    code: AddonImportErrorCode,
    message?: string,
    extra: AddonImportErrorExtra = {},
  ) {
    const body: AddonImportErrorBody = {
      code,
      message: message ?? DEFAULT_MESSAGES[code],
      ...(extra.addCharacter ? { addCharacter: extra.addCharacter } : {}),
    };
    super(body, addonImportStatus(code));
    this.code = code;
    this.name = 'AddonImportError';
  }

  get body(): AddonImportErrorBody {
    return this.getResponse() as AddonImportErrorBody;
  }
}
