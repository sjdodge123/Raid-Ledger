/**
 * ROK-1769: Sign Up / Tentative on an existing departed/declined row. A
 * linked member re-signs through `SignupsService.signup()` (the web path) so
 * the departure's bench row is released and access re-syncs.
 */
import * as schema from '../../drizzle/schema';
import { isCancelledStatus } from '../../events/signups-signup.helpers';
import type { SignupInteractionDeps } from './signup-interaction.types';

type ExistingSignup = NonNullable<
  Awaited<
    ReturnType<SignupInteractionDeps['signupsService']['findByDiscordUser']>
  >
>;

export interface Reactivation {
  reactivated: boolean;
  assignedSlot?: string | undefined;
}

export async function reactivateIfNeeded(
  eventId: number,
  existingSignup: ExistingSignup,
  linkedUser: typeof schema.users.$inferSelect | null,
  deps: SignupInteractionDeps,
): Promise<Reactivation> {
  if (existingSignup.status === 'signed_up') return { reactivated: false };
  const resignup = await resignupIfDeparted(
    eventId,
    existingSignup,
    linkedUser,
    deps,
  );
  if (!resignup)
    await deps.signupsService.updateStatus(
      eventId,
      existingSignup.discordUserId
        ? { discordUserId: existingSignup.discordUserId }
        : { userId: existingSignup.user.id },
      { status: 'signed_up' },
    );
  void deps.updateEmbedSignupCount(eventId);
  return { reactivated: true, assignedSlot: resignup?.assignedSlot };
}

/**
 * ROK-1769: a linked member's departed/declined row re-signs through
 * `signup()` — like the web — so the departure's bench row is released, the
 * member is re-placed (slot if free, else bench) and `signup_reactivated`
 * re-syncs the embed and private-voice access. Null when not applicable.
 */
export async function resignupIfDeparted(
  eventId: number,
  existingSignup: Pick<ExistingSignup, 'status'>,
  linkedUser: typeof schema.users.$inferSelect | null,
  deps: Pick<SignupInteractionDeps, 'signupsService'>,
): Promise<{ assignedSlot?: string | undefined } | null> {
  if (!linkedUser || !isCancelledStatus(existingSignup.status)) return null;
  const result = await deps.signupsService.signup(eventId, linkedUser.id);
  return { assignedSlot: result.assignedSlot ?? undefined };
}
