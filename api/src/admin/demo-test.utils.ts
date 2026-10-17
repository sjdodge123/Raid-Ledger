import { BadRequestException, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import type { UsersService } from '../users/users.service';

/** Parse and validate body with a Zod schema, throwing 400 on failure. */
export function parseDemoBody<T>(schema: z.ZodSchema<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const messages = result.error.issues
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join('; ');
    throw new BadRequestException(`Validation failed: ${messages}`);
  }
  return result.data;
}

/** A Discord snowflake: 17-20 digits (shorter ids predate Discord's epoch). */
export const snowflakeSchema = z
  .string()
  .regex(/^\d{17,20}$/, 'must be a Discord snowflake');

/** Discord ids a real voice state can never carry (unlinked / local-only). */
const UNLINKED_PREFIXES = ['local:', 'unlinked:'];

/** The Discord member a real voice state would carry for a seeded user. */
export interface LinkedDemoMember {
  discordUserId: string;
  discordUsername: string;
  discordAvatarHash: string | null;
}

/**
 * Load `userId` as the Discord member a real voice join would carry, for the
 * DEMO_MODE voice seams. 404 when the user is unknown; 400 when the user has
 * no real Discord link (no id, or a `local:` / `unlinked:` placeholder).
 */
export async function loadLinkedDemoMember(
  usersService: Pick<UsersService, 'findById'>,
  userId: number,
): Promise<LinkedDemoMember> {
  const user = await usersService.findById(userId);
  if (!user) throw new NotFoundException(`User ${userId} not found`);
  const discordId = user.discordId;
  if (!discordId || UNLINKED_PREFIXES.some((p) => discordId.startsWith(p))) {
    throw new BadRequestException(`User ${userId} is not Discord-linked`);
  }
  return {
    discordUserId: discordId,
    discordUsername: user.username,
    discordAvatarHash: user.avatar ?? null,
  };
}
