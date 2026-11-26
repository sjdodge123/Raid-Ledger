/**
 * ROK-2329 — which signup rows a reschedule DM's Confirm / Tentative may
 * touch. A departed row is refused; a declined / roached-out row re-signs
 * through the normal signup path (every check applies) instead of being
 * flipped directly; an active row (pending, signed up, tentative) re-confirms
 * as before.
 */
import { ConflictException, ForbiddenException, Logger } from '@nestjs/common';
import { and, eq, notInArray } from 'drizzle-orm';
import { CHARACTER_ROLES } from '@raid-ledger/contract';
import type {
  ButtonInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import * as schema from '../../drizzle/schema';
import { isCancelledStatus } from '../../events/signups-signup.helpers';
import { unclaimedOrOwnedBy } from '../../events/signups-ownership.helpers';
import { errorStack } from '../../common/error-format.helpers';
import {
  logDiscordAck,
  lookupRescheduleEvent,
  safeEditReply,
  type RescheduleEventRow,
  type EventRow,
  type ReconfirmOptions,
  type RescheduleDeps,
} from './reschedule-response.helpers';

type AnyInteraction = ButtonInteraction | StringSelectMenuInteraction;
export type RescheduleSignupRow = typeof schema.eventSignups.$inferSelect;

/** Reply to a Confirm / Tentative on a departed row. */
export const RESCHEDULE_DEPARTED_REPLY =
  "You've left this event, so this reschedule message can't sign you back up. Sign up again from the event itself if you'd like to rejoin.";

/** A reschedule action the user may not take; its message is the reply. */
export class RescheduleRefusedError extends Error {}

/** True when this signup row may not be re-entered from a reschedule DM. */
export function isRescheduleRefusedStatus(status: string): boolean {
  return status === 'departed';
}

/** The caller's own signup row for this event (guest rows for an unlinked id). */
export async function findRescheduleRow(
  deps: RescheduleDeps,
  interaction: AnyInteraction,
  event: EventRow,
  userId?: number,
): Promise<RescheduleSignupRow | undefined> {
  const where = userId
    ? and(
        eq(schema.eventSignups.eventId, event.id),
        eq(schema.eventSignups.userId, userId),
      )
    : // ROK-2097: an unlinked id reaches guest rows only.
      and(
        eq(schema.eventSignups.eventId, event.id),
        eq(schema.eventSignups.discordUserId, interaction.user.id),
        unclaimedOrOwnedBy(),
      );
  const [row] = await deps.db
    .select()
    .from(schema.eventSignups)
    .where(where)
    .limit(1);
  return row;
}

/** Throw a refusal for a departed row (a stale menu can still reach here). */
export function assertReschedulable(row: RescheduleSignupRow): void {
  if (isRescheduleRefusedStatus(row.status))
    throw new RescheduleRefusedError(RESCHEDULE_DEPARTED_REPLY);
}

/** True for a declined / roached-out row that must re-sign normally. */
export function needsResignup(row: RescheduleSignupRow): boolean {
  return isCancelledStatus(row.status);
}

/** What a declined / roached-out re-signup produced. */
export interface ResignupResult {
  signupId: number;
  /** The slot `signup()` placed the member in ('bench' when full). */
  assignedSlot: string | null | undefined;
}

/**
 * Re-sign a declined / roached-out row the way the event post's Sign Up does
 * (ROK-1769): a linked member through `signup()`, a guest by a status change.
 * Tentative matches the event post's Tentative (signup, then a status flip).
 */
export async function resignupCancelledRow(
  deps: RescheduleDeps,
  event: EventRow,
  row: RescheduleSignupRow,
  userId: number | undefined,
  options?: ReconfirmOptions,
): Promise<ResignupResult> {
  if (!userId) {
    const signupId = await resignGuestRow(deps, event, row, options);
    return { signupId, assignedSlot: undefined };
  }
  const res = await signupWithContext(deps, event, userId, options);
  // The presser acked the new time: confirm even a characterless / benched row.
  await confirmResignedRow(deps, event.id, res.id, userId);
  if (options?.signupStatus === 'tentative')
    await deps.signupsService.updateStatus(
      event.id,
      { userId },
      { status: 'tentative' },
    );
  return { signupId: res.id, assignedSlot: res.assignedSlot };
}

/** `signup()`, logging an unexpected failure with the event and user. */
async function signupWithContext(
  deps: RescheduleDeps,
  event: EventRow,
  userId: number,
  options?: ReconfirmOptions,
) {
  try {
    return await deps.signupsService.signup(event.id, userId, {
      ...(options?.characterId ? { characterId: options.characterId } : {}),
      ...(options?.preferredRoles?.length
        ? { preferredRoles: options.preferredRoles }
        : {}),
    });
  } catch (error) {
    if (refusalMessage(error) === null)
      deps.logger.error(
        `Reschedule re-signup failed (event ${event.id}, user ${userId})`,
        errorStack(error),
      );
    throw error;
  }
}

/** Confirm a re-signed row `signup()` left pending; audit the ack. */
async function confirmResignedRow(
  deps: RescheduleDeps,
  eventId: number,
  signupId: number,
  userId: number,
): Promise<void> {
  const set = { confirmationStatus: 'confirmed' as const };
  const flipped = await deps.db
    .update(schema.eventSignups)
    .set(set)
    .where(
      and(
        eq(schema.eventSignups.id, signupId),
        eq(schema.eventSignups.confirmationStatus, 'pending'),
      ),
    )
    .returning({ id: schema.eventSignups.id });
  await logDiscordAck(deps, eventId, flipped.length > 0, set, { userId });
}

/** Re-sign a guest row, storing what the member path stores. */
async function resignGuestRow(
  deps: RescheduleDeps,
  event: EventRow,
  row: RescheduleSignupRow,
  options?: ReconfirmOptions,
): Promise<number> {
  const discordUserId = row.discordUserId;
  if (!discordUserId)
    throw new Error(`Guest signup ${row.id} has no Discord id`);
  const roles = rescheduleRoles(options);
  const set = {
    roachedOutAt: null,
    confirmationStatus: 'confirmed' as const,
    ...(roles ? { preferredRoles: roles } : {}),
  };
  await deps.db
    .update(schema.eventSignups)
    .set(set)
    .where(eq(schema.eventSignups.id, row.id));
  const status = options?.signupStatus ?? 'signed_up';
  await deps.signupsService.updateStatus(
    event.id,
    { discordUserId },
    { status },
  );
  const wasPending = row.confirmationStatus === 'pending';
  await logDiscordAck(deps, event.id, wasPending, set, { discordUserId });
  return row.id;
}

/** The roles a reschedule selection stores (sanitised), when it picked any. */
export function rescheduleRoles(
  options?: ReconfirmOptions,
): string[] | undefined {
  if (options?.preferredRoles)
    return options.preferredRoles.filter((r: string) =>
      CHARACTER_ROLES.includes(r as never),
    );
  if (options?.slotRole && CHARACTER_ROLES.includes(options.slotRole as never))
    return [options.slotRole];
  return undefined;
}

/** Reply to a row that left the active statuses mid-press. */
export const RESCHEDULE_ROW_CHANGED_REPLY =
  'Your signup changed while this was being saved. Please press the button again.';

/**
 * Write an active row only while it is still active, so a row that was
 * declined or departed after it was read is not reset.
 */
export async function updateActiveRow(
  deps: Pick<RescheduleDeps, 'db'>,
  signupId: number,
  set: Record<string, unknown>,
): Promise<void> {
  const written = await deps.db
    .update(schema.eventSignups)
    .set(set)
    .where(
      and(
        eq(schema.eventSignups.id, signupId),
        notInArray(schema.eventSignups.status, [
          'declined',
          'roached_out',
          'departed',
        ]),
      ),
    )
    .returning({ id: schema.eventSignups.id });
  if (written.length === 0)
    throw new RescheduleRefusedError(RESCHEDULE_ROW_CHANGED_REPLY);
}

/** The message a refused or rejected reschedule action replies with. */
function refusalMessage(error: unknown): string | null {
  if (error instanceof RescheduleRefusedError) return error.message;
  if (error instanceof ConflictException) return error.message;
  if (error instanceof ForbiddenException) return error.message;
  return null;
}

/** Reply to a failed reschedule action: the refusal, else a generic error. */
export async function replyRescheduleError(
  i: AnyInteraction,
  error: unknown,
  logger: Logger,
  label: string,
  edit: (i: AnyInteraction, content: string) => Promise<void>,
): Promise<void> {
  const refused = refusalMessage(error);
  if (refused) {
    await edit(i, refused);
    return;
  }
  logger.error(label, errorStack(error));
  await edit(i, 'Something went wrong. Please try again.');
}

/** Refuse a Confirm / Tentative press on a departed row; true when it was. */
export async function replyIfDeparted(
  i: ButtonInteraction,
  status: string,
): Promise<boolean> {
  if (!isRescheduleRefusedStatus(status)) return false;
  await i.editReply({ content: RESCHEDULE_DEPARTED_REPLY });
  return true;
}

/** Edit an ephemeral button reply (interaction-gone errors are swallowed). */
export async function editPlain(i: AnyInteraction, content: string) {
  await safeEditReply(i, { content });
}

/** Edit a select-menu reply, removing the menu. */
export async function editClearingMenu(i: AnyInteraction, content: string) {
  await safeEditReply(i, { content, components: [] });
}

/** The event and the presser's own signup, or null after replying why not. */
export async function validateRescheduleSignup(
  deps: Pick<RescheduleDeps, 'db' | 'signupsService'>,
  i: ButtonInteraction,
  eventId: number,
): Promise<{
  event: RescheduleEventRow;
  signup: { id: number; status: string };
} | null> {
  const event = await lookupRescheduleEvent(deps.db, eventId);
  if (!event) {
    await i.editReply({ content: 'Event not found.' });
    return null;
  }
  if (event.cancelledAt) {
    await i.editReply({ content: 'This event has been cancelled.' });
    return null;
  }
  // ROK-2097: a row owned by an account this Discord id left is not theirs.
  const signup = await deps.signupsService.findByDiscordUser(
    eventId,
    i.user.id,
    { managedOnly: true },
  );
  if (!signup) {
    await i.editReply({ content: "You're not signed up for this event." });
    return null;
  }
  return { event, signup };
}
