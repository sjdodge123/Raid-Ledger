import { eq, and } from 'drizzle-orm';
import type {
  ButtonInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import * as schema from '../../drizzle/schema';
import { CHARACTER_ROLES } from '@raid-ledger/contract';
import { RESCHEDULE_BUTTON_IDS } from '../discord-bot.constants';
import { showRoleSelect } from '../utils/signup-dropdown-builders';
import type {
  EventRow,
  RescheduleDeps,
  ReconfirmOptions,
} from './reschedule-response.helpers';
import { ensureRosterAssignment } from './reschedule-slot.handlers';

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
  const updateSet = buildUpdateSet(options);
  const signupId = userId
    ? await updateLinkedSignup(deps, event, userId, updateSet, options)
    : await updateUnlinkedSignup(deps, interaction, event, updateSet);
  if (signupId) {
    await ensureRosterAssignment(deps, event, signupId, options);
  }
}

/** Handle character selection from reschedule flow. */
export async function handleCharacterSelect(
  ctx: SelectCtx,
  signupStatus: 'tentative' | undefined,
): Promise<void> {
  const characterId = ctx.interaction.values[0];
  const validated = await validateSelectCtx(ctx);
  if (!validated) return;
  const { linkedUser, event } = validated;
  const sc = event.slotConfig as Record<string, unknown> | null;
  if (sc?.type === 'mmo') {
    await showMmoRoleForChar(
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
  const opts: ReconfirmOptions = {
    characterId,
    preferredRoles: roles,
    slotRole: roles.length === 1 ? roles[0] : undefined,
    signupStatus,
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
  const linkedUser = await findLinkedUser(ctx.deps, ctx.interaction.user.id);
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
  updateSet: Record<string, unknown>,
  options?: ReconfirmOptions,
): Promise<number | undefined> {
  const where = and(
    eq(schema.eventSignups.eventId, event.id),
    eq(schema.eventSignups.userId, userId),
  );
  const [signup] = await deps.db
    .select()
    .from(schema.eventSignups)
    .where(where)
    .limit(1);
  if (!signup) return undefined;
  await deps.db
    .update(schema.eventSignups)
    .set(updateSet)
    .where(eq(schema.eventSignups.id, signup.id));
  if (options?.characterId) {
    await deps.signupsService.confirmSignup(event.id, signup.id, userId, {
      characterId: options.characterId,
    });
  }
  return signup.id;
}

async function updateUnlinkedSignup(
  deps: RescheduleDeps,
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  event: EventRow,
  updateSet: Record<string, unknown>,
): Promise<number | undefined> {
  const where = and(
    eq(schema.eventSignups.eventId, event.id),
    eq(schema.eventSignups.discordUserId, interaction.user.id),
  );
  const [signup] = await deps.db
    .select()
    .from(schema.eventSignups)
    .where(where)
    .limit(1);
  if (!signup) return undefined;
  await deps.db
    .update(schema.eventSignups)
    .set(updateSet)
    .where(eq(schema.eventSignups.id, signup.id));
  return signup.id;
}

async function findLinkedUser(
  deps: RescheduleDeps,
  discordUserId: string,
): Promise<{ id: number } | null> {
  const [user] = await deps.db
    .select()
    .from(schema.users)
    .where(eq(schema.users.discordId, discordUserId))
    .limit(1);
  return user ?? null;
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

async function showMmoRoleForChar(
  deps: RescheduleDeps,
  interaction: StringSelectMenuInteraction,
  event: EventRow,
  linkedUser: { id: number },
  characterId: string,
  signupStatus: 'tentative' | undefined,
): Promise<void> {
  const isTentative = signupStatus === 'tentative';
  const character = await deps.charactersService.findOne(
    linkedUser.id,
    characterId,
  );
  await showRoleSelect(interaction, {
    customIdPrefix: RESCHEDULE_BUTTON_IDS.ROLE_SELECT,
    eventId: event.id,
    emojiService: deps.emojiService,
    characterId,
    characterInfo: {
      name: character.name,
      role: character.roleOverride ?? character.role ?? null,
    },
    characterVerb: isTentative ? 'Tentative as' : 'Confirming as',
    customIdSuffix: isTentative ? 'tentative' : undefined,
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
    signupStatus,
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
  const linkedUser = await findLinkedUser(ctx.deps, ctx.interaction.user.id);
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
