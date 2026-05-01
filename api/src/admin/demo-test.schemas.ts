import { z } from 'zod';

export const LinkDiscordSchema = z.object({
  userId: z.number().int().positive(),
  discordId: z.string().regex(/^\d{17,20}$/, 'Invalid Discord ID format'),
  username: z.string().min(1).max(100),
});

export const EnableNotificationsSchema = z.object({
  userId: z.number().int().positive(),
});

const VALID_ROLES = [
  'tank',
  'healer',
  'dps',
  'flex',
  'player',
  'bench',
] as const;

export const AddGameInterestSchema = z.object({
  userId: z.number().int().positive(),
  gameId: z.number().int().positive(),
});

export const TriggerDepartureSchema = z.object({
  eventId: z.number().int().positive(),
  signupId: z.number().int().positive(),
  discordUserId: z.string().min(1),
});

export const CancelSignupSchema = z.object({
  eventId: z.number().int().positive(),
  userId: z.number().int().positive(),
});

export const TriggerClassifySchema = z.object({
  eventId: z.number().int().positive(),
});

export const InjectVoiceSessionSchema = z.object({
  eventId: z.number().int().positive(),
  discordUserId: z.string().min(1),
  userId: z.number().int().positive(),
  durationSec: z.number().int().nonnegative(),
  firstJoinAt: z.string().datetime().optional(),
  lastLeaveAt: z.string().datetime().optional(),
});

export const AwaitProcessingSchema = z.object({
  timeoutMs: z.number().int().positive().max(60_000).optional(),
});

export const SetSteamAppIdSchema = z.object({
  gameId: z.number().int().positive(),
  steamAppId: z.number().int().positive(),
});

export const GetGameSchema = z.object({
  id: z.number().int().positive(),
});

export const ClearGameInterestSchema = z.object({
  userId: z.number().int().positive(),
  gameId: z.number().int().positive(),
});

export const SetAutoHeartPrefSchema = z.object({
  userId: z.number().int().positive(),
  enabled: z.boolean(),
});

export const CreateBuildingLineupSchema = z.object({
  createdByUserId: z.number().int().positive(),
});

export const NominateGameTestSchema = z.object({
  lineupId: z.number().int().positive(),
  gameId: z.number().int().positive(),
  userId: z.number().int().positive(),
});

export const ArchiveLineupSchema = z.object({
  lineupId: z.number().int().positive(),
});

/**
 * Phases archived by `/admin/test/reset-lineups` (ROK-1070).
 *
 * Default behaviour (no phases supplied) preserves the original ROK-1147
 * contract — only `building` and `voting` rows are archived. Pass a broader
 * array (e.g. `['building', 'voting', 'decided', 'scheduling']`) when the
 * caller's fixtures depend on archiving lineups already past `voting`
 * (e.g. scheduling-poll fixtures live on `decided` rows).
 */
const VALID_LINEUP_PHASES = [
  'building',
  'voting',
  'decided',
  'scheduling',
] as const;

export const ResetLineupsSchema = z.object({
  titlePrefix: z.string().min(1).max(64),
  phases: z.array(z.enum(VALID_LINEUP_PHASES)).min(1).optional(),
});

/**
 * Body for `/admin/test/seed-slow-queries-log` (ROK-1070).
 *
 * Empty object is the only valid shape today. Reserved for a future
 * `entryCount` knob if smoke tests ever need to control how many
 * digest blocks are pre-seeded.
 */
export const SeedSlowQueriesLogSchema = z.object({}).strict();

/**
 * Body for `/admin/test/reset-events` (ROK-1070).
 *
 * Mirrors the lineup reset contract — caller passes a per-worker
 * `titlePrefix` so sibling workers' events are untouched.
 */
export const ResetEventsSchema = z.object({
  titlePrefix: z.string().min(1).max(64),
});

export const SetAutoNominatePrefSchema = z.object({
  userId: z.number().int().positive(),
  enabled: z.boolean(),
});

const VALID_STATUSES = ['signed_up', 'tentative', 'declined'] as const;

export const CreateTestSignupSchema = z.object({
  eventId: z.number().int().positive(),
  userId: z.number().int().positive(),
  preferredRoles: z.array(z.enum(VALID_ROLES)).optional(),
  characterId: z.string().uuid().optional(),
  status: z.enum(VALID_STATUSES).optional(),
});

export const SetEventTimesSchema = z.object({
  eventId: z.number().int().positive(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
});

export const CancelLineupPhaseJobsSchema = z.object({
  lineupId: z.number().int().positive(),
});

export const AiChatSimulateSchema = z.object({
  discordUserId: z.string().min(1),
  text: z.string().optional(),
  buttonId: z.string().optional(),
});

export const ExpireAiChatSessionSchema = z.object({
  discordUserId: z.string().min(1),
});

export const SetAiChatEnabledSchema = z.object({
  enabled: z.boolean(),
});

export const AdvanceStandalonePollDeadlineSchema = z.object({
  lineupId: z.number().int().positive(),
  hoursUntilDeadline: z.number().min(-720).max(720),
});
