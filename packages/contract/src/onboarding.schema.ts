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
  connectPlugins: z.boolean(),
});

export type OnboardingStepStatusDto = z.infer<typeof OnboardingStepStatusSchema>;

export const OnboardingStatusSchema = z.object({
  completed: z.boolean(),
  currentStep: z.number().min(0).max(3),
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
// Step Navigation
// ============================================================

export const UpdateStepSchema = z.object({
  step: z.number().int().min(0).max(3),
});

export type UpdateStepDto = z.infer<typeof UpdateStepSchema>;

// ============================================================
// Step 3: Connect Data Sources
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
