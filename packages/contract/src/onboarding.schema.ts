import { z } from 'zod';

/**
 * Admin Onboarding Wizard schemas (ROK-204)
 */

// ============================================================
// Onboarding Status
// ============================================================

export const OnboardingStepStatusSchema = z.object({
  secureAccount: z.boolean(),
  communityIdentity: z.boolean(),
  chooseGames: z.boolean(),
  connectDataSources: z.boolean(),
});

export type OnboardingStepStatusDto = z.infer<typeof OnboardingStepStatusSchema>;

export const OnboardingStatusSchema = z.object({
  completed: z.boolean(),
  currentStep: z.number().min(0).max(4),
  steps: OnboardingStepStatusSchema,
});

export type OnboardingStatusDto = z.infer<typeof OnboardingStatusSchema>;

// ============================================================
// Step 1: Secure Account
// ============================================================

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters'),
});

export type ChangePasswordDto = z.infer<typeof ChangePasswordSchema>;

// ============================================================
// Step 2: Community Identity
// ============================================================

export const CommunityIdentitySchema = z.object({
  communityName: z
    .string()
    .min(1, 'Community name is required')
    .max(60, 'Community name must be at most 60 characters')
    .optional(),
  defaultTimezone: z.string().optional(),
});

export type CommunityIdentityDto = z.infer<typeof CommunityIdentitySchema>;

// ============================================================
// Step 3: Choose Games
// ============================================================

export const UpdateStepSchema = z.object({
  step: z.number().int().min(0).max(4),
});

export type UpdateStepDto = z.infer<typeof UpdateStepSchema>;

export const GameToggleSchema = z.object({
  enabled: z.boolean(),
});

export type GameToggleDto = z.infer<typeof GameToggleSchema>;

export const BulkToggleGamesSchema = z.object({
  ids: z.array(z.string().uuid()),
  enabled: z.boolean(),
});

export type BulkToggleGamesDto = z.infer<typeof BulkToggleGamesSchema>;

/** Game registry item extended with enabled flag for onboarding */
export const OnboardingGameSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  iconUrl: z.string().nullable(),
  colorHex: z.string().nullable(),
  enabled: z.boolean(),
});

export type OnboardingGameDto = z.infer<typeof OnboardingGameSchema>;

export const OnboardingGameListSchema = z.object({
  data: z.array(OnboardingGameSchema),
  meta: z.object({
    total: z.number(),
    enabledCount: z.number(),
  }),
});

export type OnboardingGameListDto = z.infer<typeof OnboardingGameListSchema>;

// ============================================================
// Step 4: Connect Data Sources
// ============================================================

export const DataSourceStatusSchema = z.object({
  blizzard: z.object({
    configured: z.boolean(),
  }),
  igdb: z.object({
    configured: z.boolean(),
  }),
  discord: z.object({
    configured: z.boolean(),
  }),
});

export type DataSourceStatusDto = z.infer<typeof DataSourceStatusSchema>;
