import { eq } from 'drizzle-orm';
import type { StringSelectMenuInteraction } from 'discord.js';
import * as schema from '../../drizzle/schema';
import type { PugRole } from '@raid-ledger/contract';
import type { PugInviteDeps } from './pug-invite.helpers';
import {
  safeDeferUpdate,
  buildAcceptedEmbed,
  safeEditDmEmbed,
  safeErrorReply,
  capitalizeRole,
} from './pug-invite.helpers';
import {
  findLinkedUser,
  showMemberRoleSelect,
} from './pug-invite-member.handlers';

/** Context for member select menu operations. */
interface MemberSelectCtx {
  deps: PugInviteDeps;
  interaction: StringSelectMenuInteraction;
  eventId: number;
  userId: number;
}

/** Handle member character select menu interaction. */
export async function handleMemberCharacterSelectMenu(
  deps: PugInviteDeps,
  interaction: StringSelectMenuInteraction,
  eventIdStr: string,
): Promise<void> {
  if (!(await safeDeferUpdate(interaction, deps.logger))) return;
  try {
    await doMemberCharacterSelect(deps, interaction, eventIdStr);
  } catch (error) {
    deps.logger.error(
      'Error handling member char select for event %s:',
      eventIdStr,
      error,
    );
    await safeErrorReply(
      interaction,
      'Something went wrong. Please try again.',
    );
  }
}

/** Handle member role select menu interaction. */
export async function handleMemberRoleSelectMenu(
  deps: PugInviteDeps,
  interaction: StringSelectMenuInteraction,
  eventIdStr: string,
  characterId?: string,
): Promise<void> {
  if (!(await safeDeferUpdate(interaction, deps.logger))) return;
  try {
    await doMemberRoleSelect(deps, interaction, eventIdStr, characterId);
  } catch (error) {
    deps.logger.error(
      'Error handling member role select for event %s:',
      eventIdStr,
      error,
    );
    await safeErrorReply(
      interaction,
      'Something went wrong. Please try again.',
    );
  }
}

// --- Internal helpers ---

async function doMemberCharacterSelect(
  deps: PugInviteDeps,
  interaction: StringSelectMenuInteraction,
  eventIdStr: string,
): Promise<void> {
  const characterId = interaction.values[0];
  const eventId = parseInt(eventIdStr, 10);
  const linkedUser = await findLinkedUser(deps, interaction.user.id);
  if (!linkedUser) {
    await interaction.editReply({
      content: 'Could not find your linked account.',
      components: [],
    });
    return;
  }
  const character = await deps.charactersService.findOne(
    linkedUser.id,
    characterId,
  );
  const ctx: MemberSelectCtx = {
    deps,
    interaction,
    eventId,
    userId: linkedUser.id,
  };
  await routeCharResult(ctx, characterId, character);
}

async function routeCharResult(
  ctx: MemberSelectCtx,
  characterId: string,
  character: {
    name: string;
    roleOverride?: string | null;
    role?: string | null;
  },
): Promise<void> {
  const [event] = await ctx.deps.db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, ctx.eventId))
    .limit(1);
  const sc = event?.slotConfig as Record<string, unknown> | null;
  if (sc?.type === 'mmo') {
    await showMemberRoleSelect(ctx.interaction, ctx.eventId, event.title, {
      id: characterId,
      name: character.name,
      role: character.roleOverride ?? character.role ?? null,
    });
    return;
  }
  await signupWithCharacter(ctx, characterId, character.name);
}

async function signupWithCharacter(
  ctx: MemberSelectCtx,
  characterId: string,
  characterName: string,
): Promise<void> {
  const signupResult = await trySignupWithChar(ctx, characterId);
  if (!signupResult) return;
  await ctx.deps.signupsService.confirmSignup(
    ctx.eventId,
    signupResult.id,
    ctx.userId,
    { characterId },
  );
  const embed = buildAcceptedEmbed(
    `You signed up as **${characterName}**! See you at the event!`,
  );
  await safeEditDmEmbed(ctx.interaction, embed);
  await ctx.interaction.editReply({
    content: `Signed up as **${characterName}**!`,
    components: [],
  });
}

/** Try to create a signup using a character's role. Returns null on failure. */
async function trySignupWithChar(
  ctx: MemberSelectCtx,
  characterId: string,
): Promise<{ id: number } | null> {
  try {
    const char = await ctx.deps.charactersService.findOne(
      ctx.userId,
      characterId,
    );
    const role = (char.roleOverride ?? char.role ?? 'dps') as
      | 'tank'
      | 'healer'
      | 'dps'
      | 'flex'
      | 'player'
      | 'bench';
    return await ctx.deps.signupsService.signup(ctx.eventId, ctx.userId, {
      slotRole: role,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to sign up';
    await ctx.interaction.editReply({ content: msg, components: [] });
    return null;
  }
}

async function doMemberRoleSelect(
  deps: PugInviteDeps,
  interaction: StringSelectMenuInteraction,
  eventIdStr: string,
  characterId?: string,
): Promise<void> {
  const selectedRole = interaction.values[0] as PugRole;
  const eventId = parseInt(eventIdStr, 10);
  const linkedUser = await findLinkedUser(deps, interaction.user.id);
  if (!linkedUser) {
    await interaction.editReply({
      content: 'Could not find your linked account.',
      components: [],
    });
    return;
  }
  const ctx: MemberSelectCtx = {
    deps,
    interaction,
    eventId,
    userId: linkedUser.id,
  };
  const signupResult = await tryRoleSignup(ctx, selectedRole);
  if (!signupResult) return;
  await finalizeRoleSignup(ctx, signupResult.id, selectedRole, characterId);
}

/** Try to create a signup with a role. Returns null on failure. */
async function tryRoleSignup(
  ctx: MemberSelectCtx,
  role: 'tank' | 'healer' | 'dps' | 'flex' | 'player' | 'bench',
): Promise<{ id: number } | null> {
  try {
    return await ctx.deps.signupsService.signup(ctx.eventId, ctx.userId, {
      slotRole: role,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to sign up';
    await ctx.interaction.editReply({ content: msg, components: [] });
    return null;
  }
}

async function finalizeRoleSignup(
  ctx: MemberSelectCtx,
  signupId: number,
  selectedRole: string,
  characterId?: string,
): Promise<void> {
  const charName = characterId
    ? await confirmCharacterAndGetName(ctx, signupId, characterId)
    : undefined;
  const roleDisplay = capitalizeRole(selectedRole);
  const charDisplay = charName ? ` as **${charName}**` : '';
  const embed = buildAcceptedEmbed(
    `You signed up${charDisplay} (${roleDisplay})! See you at the event!`,
  );
  await safeEditDmEmbed(ctx.interaction, embed);
  await ctx.interaction.editReply({
    content: `Signed up${charDisplay} (${roleDisplay})!`,
    components: [],
  });
  ctx.deps.logger.log(
    'Member accepted invite for event %d as %s',
    ctx.eventId,
    selectedRole,
  );
}

async function confirmCharacterAndGetName(
  ctx: MemberSelectCtx,
  signupId: number,
  characterId: string,
): Promise<string | undefined> {
  try {
    const character = await ctx.deps.charactersService.findOne(
      ctx.userId,
      characterId,
    );
    await ctx.deps.signupsService.confirmSignup(
      ctx.eventId,
      signupId,
      ctx.userId,
      { characterId },
    );
    return character.name;
  } catch {
    return undefined;
  }
}
