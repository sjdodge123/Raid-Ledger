import { BadRequestException } from '@nestjs/common';
import type { HubMediaKind } from '@raid-ledger/contract';

/** A feed position: the last item's `(captured_at, id)` (spec D13). */
export interface HubMediaCursor {
  capturedAt: Date;
  id: number;
}

/** Opaque base64url `<iso>|<id>`. */
export function encodeHubMediaCursor(c: HubMediaCursor): string {
  return Buffer.from(`${c.capturedAt.toISOString()}|${c.id}`).toString(
    'base64url',
  );
}

/** Parse a cursor the list route handed out; anything else → 400. */
export function decodeHubMediaCursor(raw: string): HubMediaCursor {
  const [iso, idRaw, extra] = Buffer.from(raw, 'base64url')
    .toString('utf8')
    .split('|');
  const capturedAt = new Date(iso ?? '');
  const id = Number(idRaw);
  if (
    extra !== undefined ||
    Number.isNaN(capturedAt.getTime()) ||
    !Number.isSafeInteger(id) ||
    id <= 0
  ) {
    throw new BadRequestException('Invalid cursor');
  }
  return { capturedAt, id };
}

/**
 * The web's chips are All · Deaths · Screenshots (Lead decision): the
 * `screenshot` filter means every non-death picture — `screenshot` + plain
 * `image`. `death` and `image` match only themselves; no filter → all kinds.
 */
export function kindsForFilter(
  kind: HubMediaKind | undefined,
): HubMediaKind[] | null {
  if (kind === undefined) return null;
  if (kind === 'screenshot') return ['screenshot', 'image'];
  return [kind];
}
