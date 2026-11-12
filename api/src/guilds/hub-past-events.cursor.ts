import { BadRequestException } from '@nestjs/common';
import { GuildPastEventsQuerySchema } from '@raid-ledger/contract';
import { z } from 'zod';

/**
 * ROK-2185 item 3 — the keyset cursor of `GET /guilds/:id/events/past`: the
 * last card's `(upper(duration), id)`, as base64url JSON. Opaque to the client
 * (the contract only bounds its length); only this file reads its fields.
 */
export interface PastCursor {
  /** `upper(events.duration)` of the last card on the previous page. */
  endsAt: Date;
  /** `events.id` of that card — breaks ties on equal end times. */
  id: number;
}

const PayloadSchema = z.object({
  e: z.string().datetime(),
  i: z.number().int().positive(),
});

/** Encode the last card's sort key as the next page's cursor. */
export function encodePastCursor(key: PastCursor): string {
  const json = JSON.stringify({ e: key.endsAt.toISOString(), i: key.id });
  return Buffer.from(json, 'utf8').toString('base64url');
}

/** Decode a client cursor; null when it is not one this server issued. */
export function decodePastCursor(raw: string): PastCursor | null {
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch (err) {
    if (err instanceof SyntaxError) return null;
    throw err;
  }
  const parsed = PayloadSchema.safeParse(json);
  if (!parsed.success) return null;
  return { endsAt: new Date(parsed.data.e), id: parsed.data.i };
}

/**
 * Validate the route's query: no cursor → null (newest page), a cursor this
 * server issued → its key.
 * @throws BadRequestException a malformed query or an undecodable cursor
 */
export function parsePastEventsQuery(query: unknown): PastCursor | null {
  const parsed = GuildPastEventsQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw new BadRequestException(parsed.error.flatten().fieldErrors);
  }
  if (parsed.data.cursor === undefined) return null;
  const key = decodePastCursor(parsed.data.cursor);
  if (key === null) throw new BadRequestException('Invalid cursor');
  return key;
}
