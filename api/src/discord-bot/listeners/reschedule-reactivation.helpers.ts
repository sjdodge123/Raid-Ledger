/**
 * ROK-2329 — which signup rows a reschedule DM's Confirm / Tentative may
 * touch. A departed row is refused; a declined / roached-out row re-signs
 * through the normal signup path (every check applies) instead of being
 * flipped directly; an active row (pending, signed up, tentative) re-confirms
 * as before.
 */
import { ConflictException, ForbiddenException, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type {
  ButtonInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import * as schema from '../../drizzle/schema';
import { isCancelledStatus } from '../../events/signups-signup.helpers';
import { unclaimedOrOwnedBy } from '../../events/signups-ownership.helpers';
import { errorStack } from '../../common/error-format.helpers';
import {
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

/**
 * Re-sign a declined / roached-out row the way the event post's Sign Up does
 * (ROK-1769): a linked member through `signup()`, a guest by a status change.
 */
export async function resignupCancelledRow(
  deps: RescheduleDeps,
  event: EventRow,
  row: RescheduleSignupRow,
  userId: number | undefined,
  options?: ReconfirmOptions,
): Promise<number> {
  const status = options?.signupStatus ?? 'signed_up';
  if (userId) {
    const res = await deps.signupsService.signup(event.id, userId, {
      ...(options?.characterId ? { characterId: options.characterId } : {}),
      ...(options?.preferredRoles?.length
        ? { preferredRoles: options.preferredRoles }
        : {}),
    });
    if (status === 'tentative')
      await deps.signupsService.updateStatus(event.id, { userId }, { status });
    return res.id;
  }
  const discordUserId = row.discordUserId ?? '';
  await deps.signupsService.updateStatus(
    event.id,
    { discordUserId },
    { status },
  );
  return row.id;
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
