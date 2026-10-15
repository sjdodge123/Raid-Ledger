import { z } from 'zod';

/**
 * ROK-1767: auto-maintained per-game Discord @role. An admin links a game to
 * a Discord role (existing, or bot-created); the daily reconcile adds members
 * who played the game within the window and removes the ones the bot granted
 * who went idle. Hand-assigned holders are never removed.
 */

/** User preference key: `true` opts the member out of auto game roles. */
export const GAME_ROLES_OPT_OUT_PREF_KEY = 'discord_game_roles_opt_out';

/** Default inactivity window, in days. */
export const GAME_ROLE_DEFAULT_WINDOW_DAYS = 14;

export const GameRoleWindowDaysSchema = z.number().int().min(1).max(365);

/** PUT body: link a game to a role. `roleId: null` ⇒ the bot creates one. */
export const UpsertGameRoleSchema = z.object({
  roleId: z.string().min(1).max(32).nullable(),
  windowDays: GameRoleWindowDaysSchema.default(GAME_ROLE_DEFAULT_WINDOW_DAYS),
  /** Name for a bot-created role; defaults to the game name. */
  name: z.string().trim().min(1).max(100).optional(),
});
export type UpsertGameRoleDto = z.infer<typeof UpsertGameRoleSchema>;

export const GameRoleSummarySchema = z.object({
  gameId: z.number().int().positive(),
  gameName: z.string(),
  roleId: z.string(),
  roleName: z.string().nullable(),
  botCreated: z.boolean(),
  windowDays: GameRoleWindowDaysSchema,
  enabled: z.boolean(),
  lastReconciledAt: z.string().nullable(),
  grantedCount: z.number().int().nonnegative(),
});
export type GameRoleSummaryDto = z.infer<typeof GameRoleSummarySchema>;

export const GameRolePreflightProblemCodeSchema = z.enum([
  'missing_manage_roles',
  'role_above_bot',
  'role_managed',
  'role_not_found',
  'bot_disconnected',
]);
export type GameRolePreflightProblemCode = z.infer<
  typeof GameRolePreflightProblemCodeSchema
>;

export const GameRolePreflightSchema = z.object({
  ok: z.boolean(),
  problems: z.array(
    z.object({
      code: GameRolePreflightProblemCodeSchema,
      message: z.string(),
    }),
  ),
});
export type GameRolePreflightDto = z.infer<typeof GameRolePreflightSchema>;

export const GameRoleAuditActionSchema = z.enum(['role_added', 'role_removed']);
export type GameRoleAuditAction = z.infer<typeof GameRoleAuditActionSchema>;

export const GameRoleAuditEntrySchema = z.object({
  userId: z.number().int().positive(),
  username: z.string(),
  action: GameRoleAuditActionSchema,
  reason: z.string(),
  at: z.string(),
});
export type GameRoleAuditEntryDto = z.infer<typeof GameRoleAuditEntrySchema>;

export const GameRoleRunResultSchema = z.object({
  added: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  skippedOverCap: z.number().int().nonnegative(),
  failedGames: z.array(z.number().int().positive()),
});
export type GameRoleRunResultDto = z.infer<typeof GameRoleRunResultSchema>;
