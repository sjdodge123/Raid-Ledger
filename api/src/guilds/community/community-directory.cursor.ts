import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import type { HubDirectoryQuery } from '@raid-ledger/contract';

/** ROK-1870 L3 — the opaque base64url keyset cursor of `GET /hubs`. */

/** Keys are bound as `::int` (int4); a larger value would 500 in Postgres. */
const INT4_MAX = 2147483647;

const CursorSchema = z
  .object({
    s: z.enum(['members', 'name', 'newest']),
    v: z.string(),
    id: z.number().int().positive().max(INT4_MAX),
  })
  .strict();
/** A decoded cursor: the sort it belongs to, its key value and row id. */
export type DirectoryCursor = z.infer<typeof CursorSchema>;

/** Encode the last row's key. */
export function encodeCursor(c: DirectoryCursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

/** Decode; 400 on a forged cursor or one minted for another sort (M12). */
export function decodeCursor(
  raw: string | undefined,
  sort: HubDirectoryQuery['sort'],
): DirectoryCursor | null {
  if (raw === undefined) return null;
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
  const parsed = CursorSchema.safeParse(json);
  if (!parsed.success || parsed.data.s !== sort) {
    throw new BadRequestException('Invalid cursor');
  }
  return parsed.data;
}

/**
 * The `members` sort key as an int4 member count; 400 on anything else, since
 * it is bound as `::int` and an out-of-range value would 500 in Postgres.
 */
export function parseMembersKey(v: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > INT4_MAX) {
    throw new BadRequestException('Invalid cursor');
  }
  return n;
}
