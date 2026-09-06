/**
 * ROK-1483 — the pure half of the `POST /admin/test/thread-mirror` seam:
 * body schema, and seeded-message → mirror-row adaptation.
 *
 * Split from the controller so the controller stays inside the 300-line cap
 * (and well inside this story's 120-line budget for it) and so the adaptation
 * can be unit-tested without a Nest testing module.
 */
import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import {
  toMirrorRow,
  type MirroredMessageValues,
  type MirrorSourceMessage,
} from '../discord-bot/thread-mirror/thread-mirror.helpers';

/** One fabricated Discord message. `createdAt` defaults to now. */
export const SeedMessageSchema = z.object({
  messageId: z.string().min(1),
  authorDiscordId: z.string().min(1),
  authorDisplayName: z.string().min(1),
  content: z.string(),
  createdAt: z.string().datetime().optional(),
});

/** `messages: null` means "clear the mirror", not "seed nothing". */
export const SeedThreadMirrorSchema = z.object({
  threadId: z.string().min(1),
  guildId: z.string().min(1).optional(),
  surfaceKind: z.literal('lfg-group'),
  surfaceId: z.string().min(1),
  messages: z.array(SeedMessageSchema).nullable(),
});

export type SeedMessage = z.infer<typeof SeedMessageSchema>;
export type SeedThreadMirrorBody = z.infer<typeof SeedThreadMirrorSchema>;

/**
 * Narrow an `lfg-group` surface id to the game id it actually is.
 *
 * @param surfaceId - The surface id from the request body.
 * @returns The positive integer game id.
 * @throws BadRequestException when it is not one — never a silent NaN.
 */
export function toGameId(surfaceId: string): number {
  const gameId = Number(surfaceId);
  if (!Number.isInteger(gameId) || gameId <= 0) {
    throw new BadRequestException('surfaceId must be a numeric game id');
  }
  return gameId;
}

/** Adapt a seeded message to the structural shape `toMirrorRow` consumes. */
function toSourceMessage(message: SeedMessage): MirrorSourceMessage {
  return {
    id: message.messageId,
    content: message.content,
    createdAt: message.createdAt ? new Date(message.createdAt) : new Date(),
    editedAt: null,
    author: {
      id: message.authorDiscordId,
      username: message.authorDisplayName,
      displayName: message.authorDisplayName,
      avatar: null,
      bot: true,
    },
    attachments: new Map(),
    mentions: { users: new Map(), roles: new Map(), channels: new Map() },
  };
}

/**
 * Seeded messages as mirror rows.
 *
 * Routed through the production `toMirrorRow` on purpose: deriving `sort_key`
 * here instead would let the seam drift from what the live listener writes,
 * and ordering is exactly what the smoke asserts on.
 *
 * @param messages - Fabricated messages, in any order.
 * @param guildId - The guild the thread's deep link will name.
 * @returns Insertable values, minus `thread_id` (the db helper adds it).
 */
export function toSeedRows(
  messages: SeedMessage[],
  guildId: string,
): MirroredMessageValues[] {
  return messages.map((message) =>
    toMirrorRow(toSourceMessage(message), guildId),
  );
}
