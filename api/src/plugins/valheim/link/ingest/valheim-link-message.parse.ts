import { BadRequestException } from '@nestjs/common';
import {
  VALHEIM_LINK_CAPTURED_AT_MAX_FUTURE_MS,
  VALHEIM_LINK_CHARACTER_MAX_BYTES,
  VALHEIM_LINK_ITEMS_MAX_BYTES,
  VALHEIM_LINK_MAP_MAX_BYTES,
  VALHEIM_LINK_RECIPES_MAX_BYTES,
  ValheimLinkMessageSchema,
  type ValheimLinkMessage,
  type ValheimLinkMessageKind,
} from '@raid-ledger/contract';
import { ingestError } from '../valheim-link-request';
import { valheimBitmapIsValid } from './valheim-link-bitmap.helpers';

/** CONTRACT §7 decoded-body cap per kind. */
export const VALHEIM_LINK_KIND_MAX_BYTES: Record<
  ValheimLinkMessageKind,
  number
> = {
  character: VALHEIM_LINK_CHARACTER_MAX_BYTES,
  map: VALHEIM_LINK_MAP_MAX_BYTES,
  items: VALHEIM_LINK_ITEMS_MAX_BYTES,
  recipes: VALHEIM_LINK_RECIPES_MAX_BYTES,
};

/** A schema issue as returned to the mod — never the offending value. */
export interface ValheimLinkIssue {
  path: string;
  code: string;
}

function parseJson(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw new BadRequestException(
      ingestError('bad_json', 'body is not valid JSON'),
    );
  }
}

/**
 * JSON-parse and contract-validate one message posted to the `kind` route:
 * 400 `bad_json`, 400 `schema_invalid` (issues as `{ path, code }` only),
 * 400 `kind_mismatch` when the body's kind is not the route's.
 */
export function parseValheimLinkMessage(
  kind: ValheimLinkMessageKind,
  body: Buffer,
): ValheimLinkMessage {
  const parsed = ValheimLinkMessageSchema.safeParse(parseJson(body));
  if (!parsed.success) {
    const issues: ValheimLinkIssue[] = parsed.error.issues.map((i) => ({
      path: i.path.map(String).join('.'),
      code: i.code,
    }));
    throw new BadRequestException({
      ...ingestError('schema_invalid', 'message does not match the contract'),
      issues,
    });
  }
  if (parsed.data.kind !== kind) {
    throw new BadRequestException(
      ingestError('kind_mismatch', 'body kind does not match the route'),
    );
  }
  return parsed.data;
}

/** CONTRACT §1: `capturedAt` more than 5 min past `now` → 400. */
export function assertNotFromFuture(capturedAt: string, now: Date): void {
  const at = Date.parse(capturedAt);
  if (at > now.getTime() + VALHEIM_LINK_CAPTURED_AT_MAX_FUTURE_MS) {
    throw new BadRequestException(
      ingestError('captured_at_in_future', 'capturedAt is ahead of the server'),
    );
  }
}

/** CONTRACT §6 server rule on a map's bitmaps → 400 `bitmap_invalid`. */
export function assertBitmapsValid(msg: ValheimLinkMessage): void {
  if (msg.kind !== 'map') return;
  const bitmaps = [msg.explored, msg.sharedExplored];
  for (const bitmap of bitmaps) {
    if (bitmap && !valheimBitmapIsValid(bitmap)) {
      throw new BadRequestException(
        ingestError('bitmap_invalid', 'bitmap data fails the server rule'),
      );
    }
  }
}
