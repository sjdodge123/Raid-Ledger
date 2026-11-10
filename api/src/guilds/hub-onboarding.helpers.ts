import { BadRequestException } from '@nestjs/common';
import {
  HubOnboardingDismissScopeSchema,
  HubOnboardingKeySchema,
  HubOnboardingScopeQuerySchema,
  isHubOnboardingScopedKey,
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

/** The parsed `?guildId=` / `?scope=` pair. */
export interface OnboardingScope {
  guildId: number | null;
  scope: string | null;
}

/**
 * `?guildId=` scopes the dismissal to one hub; omitted means the global
 * prompt. `?scope=` (ROK-2153 N4) narrows a hub dismissal to one provider
 * round (a BG3 campaign) and needs `guildId`. A non-numeric or non-positive
 * guildId, a malformed scope or a scope without guildId is a 400, never a
 * silent null.
 */
export function parseOnboardingScope(raw: unknown): OnboardingScope {
  const parsed = HubOnboardingScopeQuerySchema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new BadRequestException(
      'guildId must be a positive integer; scope must match ^[A-Za-z0-9_.-]{1,40}$ and needs guildId',
    );
  }
  return {
    guildId: parsed.data.guildId ?? null,
    scope: parsed.data.scope ?? null,
  };
}

/** ROK-2153 N4-D4: only a scoped key (`claim-character`) may carry a scope. */
export function assertScopeAllowed(
  key: HubOnboardingKey,
  scope: string | null,
): void {
  if (scope !== null && !isHubOnboardingScopedKey(key)) {
    throw new BadRequestException(`Onboarding key ${key} takes no scope`);
  }
}

/** ROK-2153 N4-D2: a scoped dismissal is stored as `<key>:<scope>`. */
export function toStorageKey(
  key: HubOnboardingKey,
  scope: string | null,
): string {
  return scope === null ? key : `${key}:${scope}`;
}

/**
 * Inverse of `toStorageKey`: split on the FIRST `:` (a scope has none).
 * Unknown base keys, a scope on an unscoped key and a malformed scope all
 * yield null, so the row is dropped rather than handed to the web.
 */
export function fromStorageKey(
  raw: string,
): { key: HubOnboardingKey; scope: string | null } | null {
  const at = raw.indexOf(':');
  const base = HubOnboardingKeySchema.safeParse(
    at < 0 ? raw : raw.slice(0, at),
  );
  if (!base.success) return null;
  if (at < 0) return { key: base.data, scope: null };
  const scope = HubOnboardingDismissScopeSchema.safeParse(raw.slice(at + 1));
  if (!scope.success || !isHubOnboardingScopedKey(base.data)) return null;
  return { key: base.data, scope: scope.data };
}
