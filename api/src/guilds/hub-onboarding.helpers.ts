import { BadRequestException } from '@nestjs/common';
import {
  HubOnboardingKeySchema,
  HubOnboardingScopeQuerySchema,
  type HubOnboardingKey,
} from '@raid-ledger/contract';

/**
 * ROK-1830 S5 — request parsing for the onboarding dismissal routes. Kept out
 * of the service so the 400 paths are unit-testable without a database.
 */

/** `:key` must be one of the known prompts; anything else is a 400. */
export function parseOnboardingKey(raw: unknown): HubOnboardingKey {
  const parsed = HubOnboardingKeySchema.safeParse(raw);
  if (!parsed.success) {
    throw new BadRequestException(
      `Unknown onboarding key: ${HubOnboardingKeySchema.options.join(', ')}`,
    );
  }
  return parsed.data;
}

/**
 * `?guildId=` scopes the dismissal to one hub; omitted means the global
 * prompt. A non-numeric or non-positive value is a 400, never a silent null.
 */
export function parseOnboardingScope(raw: unknown): number | null {
  const parsed = HubOnboardingScopeQuerySchema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new BadRequestException('guildId must be a positive integer');
  }
  return parsed.data.guildId ?? null;
}
