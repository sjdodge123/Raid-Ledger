import { eq } from 'drizzle-orm';
import type {
  ButtonInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import * as schema from '../../drizzle/schema';
import { CHARACTER_ROLES } from '@raid-ledger/contract';
import type {
  EventRow,
  RescheduleDeps,
  ReconfirmOptions,
} from './reschedule-response.helpers';
import {
  findLinkedUserByDiscordId,
  logDiscordAck,
} from './reschedule-response.helpers';
import {
  assertReschedulable,
  findRescheduleRow,
  needsResignup,
  resignupCancelledRow,
  type RescheduleSignupRow,
} from './reschedule-reactivation.helpers';
import { showRescheduleRoleForCharacter } from './reschedule-role-step.helpers';
import { ensureRosterAssignment } from './reschedule-slot.handlers';
import { defined } from '../../common/defined.helpers';
import { activatedAtOnReactivation } from '../../events/signup-activated-at.helpers';
import {
  announceIfLineChanged,
  type LineFields,
} from './reschedule-signup-emit.helpers';

export type { RescheduleDeps, ReconfirmOptions };

/** Context for select-menu handlers. */
export interface SelectCtx {
  deps: RescheduleDeps;
  interaction: StringSelectMenuInteraction;
  eventId: number;
  lookupEvent: (id: number) => Promise<EventRow | null>;
  editDm: (
    i: StringSelectMenuInteraction,
    s: 'confirmed' | 'tentative' | 'declined',
  ) => Promise<void>;
}

/**
 * Re-confirm an existing signup: set status, optionally update
 * character/role, and ensure a roster assignment exists.
 */
export async function reconfirmSignup(
  deps: RescheduleDeps,
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  event: EventRow,
  userId?: number,
  options?: ReconfirmOptions,
): Promise<void> {
  const row = await findRescheduleRow(deps, interaction, event, userId);
  if (!row) return;
  assertReschedulable(row); // ROK-2329: a departed row is refused.
  const updateSet = buildUpdateSet(options);
  const signupId = needsResignup(row)
    ? await resignupCancelledRow(deps, event, row, userId, options)
    : userId
      ? await updateLinkedSignup(deps, event, userId, row, updateSet, options)
      : await updateUnlinkedSignup(deps, interaction, event, row, updateSet);
  await ensureRosterAssignment(deps, event, signupId, options);
}

/** Handle character selection from reschedule flow. */
export async function handleCharacterSelect(
  ctx: SelectCtx,
  signupStatus: 'tentative' | undefined,
): Promise<void> {
  const validated = await validateSelectCtx(ctx);
  if (!validated) return;
  const { linkedUser, event } = validated;
  const characterId = defined(ctx.interaction.values[0], 'selected character');
  const sc = event.slotConfig as Record<string, unknown> | null;
  if (sc?.type === 'mmo') {
    await showRescheduleRoleForCharacter(
      ctx.deps,
      ctx.interaction,
      event,
      linkedUser,
      characterId,
      signupStatus,
    );
    return;
  }
  await finalizeCharSelect(ctx, event, linkedUser, characterId, signupStatus);
}

/** Handle role selection from reschedule flow. */
export async function handleRoleSelect(
  ctx: SelectCtx,
  characterId: string | undefined,
  signupStatus: 'tentative' | undefined,
): Promise<void> {
  const roles = ctx.interaction.values as ('tank' | 'healer' | 'dps')[];
  const event = await ctx.lookupEvent(ctx.eventId);
  if (!event || event.cancelledAt) {
    await replyEventError(ctx.interaction, event);
    return;
  }
  const isTentative = signupStatus === 'tentative';
  const slotRole = roles.length === 1 ? roles[0] : undefined;
  const opts: ReconfirmOptions = {
    ...(characterId !== undefined ? { characterId } : {}),
    preferredRoles: roles,
    ...(slotRole !== undefined ? { slotRole } : {}),
    ...(signupStatus !== undefined ? { signupStatus } : {}),
  };
  await reconfirmAndReply(ctx, event, characterId, roles, isTentative, opts);
  await ctx.editDm(ctx.interaction, isTentative ? 'tentative' : 'confirmed');
  await ctx.deps.embedSyncQueue.enqueue(
    ctx.eventId,
    isTentative ? 'reschedule-tentative' : 'reschedule-confirm',
  );
}

// ─── Internal helpers ───────────────────────────────────────────────

async function validateSelectCtx(
  ctx: SelectCtx,
): Promise<{ linkedUser: { id: number }; event: EventRow } | null> {
  const linkedUser = await findLinkedUserByDiscordId(
    ctx.deps.db,
    ctx.interaction.user.id,
  );
  if (!linkedUser) {
    await ctx.interaction.editReply({
      content: 'Could not find your linked account. Please try again.',
      components: [],
    });
    return null;
  }
  const event = await ctx.lookupEvent(ctx.eventId);
  if (!event || event.cancelledAt) {
    await replyEventError(ctx.interaction, event);
    return null;
  }
  return { linkedUser, event };
}

export function buildUpdateSet(
  options?: ReconfirmOptions,
): Record<string, unknown> {
  const set: Record<string, unknown> = {
    status: options?.signupStatus === 'tentative' ? 'tentative' : 'signed_up',
    roachedOutAt: null,
    confirmationStatus: 'confirmed',
    // ROK-2293: re-stamped only when the row was declined/roached out/departed.
    activatedAt: activatedAtOnReactivation(),
  };
  if (options?.preferredRoles) {
    set.preferredRoles = options.preferredRoles.filter((r: string) =>
      CHARACTER_ROLES.includes(r as never),
    );
  } else if (
    options?.slotRole &&
    CHARACTER_ROLES.includes(options.slotRole as never)
  ) {
    set.preferredRoles = [options.slotRole];
  }
  return set;
}

async function updateLinkedSignup(
  deps: RescheduleDeps,
  event: EventRow,
  userId: number,
  signup: RescheduleSignupRow,
  updateSet: Record<string, unknown>,
  options?: ReconfirmOptions,
): Promise<number> {
  const wasPending = signup.confirmationStatus === 'pending';
  await deps.db
    .update(schema.eventSignups)
    .set(updateSet)
    .where(eq(schema.eventSignups.id, signup.id));
  await afterLinkedWrite(deps, event.id, userId, signup, updateSet, options);
  await logDiscordAck(deps, event.id, wasPending, updateSet, { userId });
  return signup.id;
}

async function updateUnlinkedSignup(
  deps: RescheduleDeps,
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  event: EventRow,
  signup: RescheduleSignupRow,
  updateSet: Record<string, unknown>,
): Promise<number> {
  const wasPending = signup.confirmationStatus === 'pending';
  await deps.db
    .update(schema.eventSignups)
    .set(updateSet)
    .where(eq(schema.eventSignups.id, signup.id));
  announceIfLineChanged(deps, event.id, signup, updateSet);
  await logDiscordAck(deps, event.id, wasPending, updateSet, {
    discordUserId: interaction.user.id,
  });
  return signup.id;
}

/**
 * ROK-2271 — a character change goes through confirmSignup, which emits
 * signup.updated itself; otherwise announce a line-visible change here.
 */
async function afterLinkedWrite(
  deps: RescheduleDeps,
  eventId: number,
  userId: number,
  signup: LineFields & { id: number },
  updateSet: Record<string, unknown>,
  options?: ReconfirmOptions,
): Promise<void> {
  if (!options?.characterId) {
    announceIfLineChanged(deps, eventId, signup, updateSet, userId);
    return;
  }
  await deps.signupsService.confirmSignup(eventId, signup.id, userId, {
    characterId: options.characterId,
  });
}

async function replyEventError(
  interaction: StringSelectMenuInteraction,
  event: EventRow | null,
): Promise<void> {
  await interaction.editReply({
    content: event ? 'This event has been cancelled.' : 'Event not found.',
    components: [],
  });
}

async function finalizeCharSelect(
  ctx: SelectCtx,
  event: EventRow,
  linkedUser: { id: number },
  characterId: string,
  signupStatus: 'tentative' | undefined,
): Promise<void> {
  await reconfirmSignup(ctx.deps, ctx.interaction, event, linkedUser.id, {
    characterId,
    ...(signupStatus !== undefined ? { signupStatus } : {}),
  });
  const character = await ctx.deps.charactersService.findOne(
    linkedUser.id,
    characterId,
  );
  const isTentative = signupStatus === 'tentative';
  const label = isTentative ? 'marked as **tentative**' : 'confirmed';
  await ctx.interaction.editReply({
    content: `You're ${label} for **${event.title}** with **${character.name}**.`,
    components: [],
  });
  await ctx.editDm(ctx.interaction, isTentative ? 'tentative' : 'confirmed');
  const trigger = isTentative ? 'reschedule-tentative' : 'reschedule-confirm';
  await ctx.deps.embedSyncQueue.enqueue(event.id, trigger);
}

async function reconfirmAndReply(
  ctx: SelectCtx,
  event: EventRow,
  characterId: string | undefined,
  roles: ('tank' | 'healer' | 'dps')[],
  isTentative: boolean,
  opts: ReconfirmOptions,
): Promise<void> {
  const rolesLabel = roles
    .map((r) => r.charAt(0).toUpperCase() + r.slice(1))
    .join(', ');
  const linkedUser = await findLinkedUserByDiscordId(
    ctx.deps.db,
    ctx.interaction.user.id,
  );
  const label = isTentative ? 'marked as **tentative**' : 'confirmed';
  const userId = linkedUser?.id;
  await reconfirmSignup(ctx.deps, ctx.interaction, event, userId, opts);
  const content = await buildRoleReplyContent(
    ctx.deps,
    event,
    userId,
    characterId,
    rolesLabel,
    label,
  );
  await ctx.interaction.editReply({ content, components: [] });
}

/** Build the reply content for a role-select reconfirmation. */
async function buildRoleReplyContent(
  deps: RescheduleDeps,
  event: EventRow,
  userId: number | undefined,
  characterId: string | undefined,
  rolesLabel: string,
  label: string,
): Promise<string> {
  if (userId && characterId) {
    const charName = (await deps.charactersService.findOne(userId, characterId))
      .name;
    return `You're ${label} for **${event.title}** with **${charName}** (${rolesLabel}).`;
  }
  return `You're ${label} for **${event.title}** (${rolesLabel}).`;
}
