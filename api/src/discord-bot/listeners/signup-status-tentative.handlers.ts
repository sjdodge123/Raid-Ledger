import type { ButtonInteraction, EmbedBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import { showCharacterSelect, showRoleSelect } from './signup-signup.handlers';
import { fetchEvent } from './signup-interaction.helpers';
import type { SignupInteractionDeps } from './signup-interaction.types';
import { benchSuffix } from './signup-bench-feedback.helpers';
import { derivePreferredRoles } from './signup-role-derive.helpers';
import { buildReplyEmbed } from './signup-reply-embed.helpers';

/** Sign up as tentative. Returns assignedSlot for bench feedback. */
export async function signupAsTentative(
  eventId: number,
  userId: number,
  deps: SignupInteractionDeps,
): Promise<string | undefined> {
  const result = await deps.signupsService.signup(eventId, userId);
  await deps.signupsService.updateStatus(
    eventId,
    { userId },
    { status: 'tentative' },
  );
  void deps.updateEmbedSignupCount(eventId);
  return result.assignedSlot ?? undefined;
}

/** Tentative flow for a linked user without an existing signup. */
export async function handleLinkedTentative(
  interaction: ButtonInteraction,
  eventId: number,
  linkedUser: typeof schema.users.$inferSelect,
  deps: SignupInteractionDeps,
): Promise<void> {
  const event = await fetchEvent(eventId, deps);
  if (!event) {
    await interaction.editReply({ content: 'Event not found.' });
    return;
  }

  if (event.gameId) {
    const handled = await tryLinkedTentativeGameFlow({
      interaction,
      eventId,
      linkedUser,
      event,
      deps,
    });
    if (handled) return;
  }

  const assignedSlot = await signupAsTentative(eventId, linkedUser.id, deps);
  await interaction.editReply({
    content: `You're marked as **tentative**.${benchSuffix(assignedSlot)}`,
    embeds: [],
  });
}

async function loadTentativeGameContext(
  linkedUser: typeof schema.users.$inferSelect,
  event: typeof schema.events.$inferSelect,
  deps: SignupInteractionDeps,
): Promise<{
  characters: import('@raid-ledger/contract').CharacterDto[];
  isMMO: boolean;
} | null> {
  const [game] = await deps.db
    .select()
    .from(schema.games)
    .where(eq(schema.games.id, event.gameId!))
    .limit(1);
  if (!game) return null;

  const characterList = await deps.charactersService.findAllForUser(
    linkedUser.id,
    event.gameId!,
  );
  const isMMO =
    (event.slotConfig as Record<string, unknown> | null)?.type === 'mmo';
  return { characters: characterList.data, isMMO };
}

function shouldShowTentativeCharSelect(
  isMMO: boolean,
  charCount: number,
): boolean {
  return (isMMO && charCount >= 1) || charCount > 1;
}

type TentativeCtx = {
  characters: import('@raid-ledger/contract').CharacterDto[];
  isMMO: boolean;
};

type TentativeCharArgs = {
  interaction: ButtonInteraction;
  eventId: number;
  userId: number;
  event: typeof schema.events.$inferSelect;
  ctx: TentativeCtx;
  deps: SignupInteractionDeps;
  embed?: EmbedBuilder;
};

/** Handle character-based tentative branch. Returns null if not applicable. */
async function tryTentativeCharPath(
  args: TentativeCharArgs,
): Promise<boolean | null> {
  const { interaction, eventId, event, ctx, deps, embed } = args;
  if (shouldShowTentativeCharSelect(ctx.isMMO, ctx.characters.length)) {
    await showTentativeCharacterSelect(
      interaction,
      eventId,
      event.title,
      ctx.characters,
      deps,
      embed,
    );
    return true;
  }
  if (ctx.characters.length === 1)
    return tentativeSingleCharacter(
      interaction,
      eventId,
      args.userId,
      ctx.characters[0],
      deps,
    );

  return null;
}

type TentativeGameFlowArgs = {
  interaction: ButtonInteraction;
  eventId: number;
  linkedUser: typeof schema.users.$inferSelect;
  event: typeof schema.events.$inferSelect;
  deps: SignupInteractionDeps;
};

async function tryLinkedTentativeGameFlow(
  a: TentativeGameFlowArgs,
): Promise<boolean> {
  const { interaction, eventId, linkedUser, event, deps } = a;
  const ctx = await loadTentativeGameContext(linkedUser, event, deps);
  if (!ctx) return false;
  const embed = await buildReplyEmbed(eventId, deps);
  const charResult = await tryTentativeCharPath({
    interaction,
    eventId,
    userId: linkedUser.id,
    event,
    ctx,
    deps,
    embed,
  });
  if (charResult !== null) return charResult;
  if (!ctx.isMMO) return false;
  await showRoleSelect(
    interaction,
    eventId,
    deps,
    undefined,
    undefined,
    'tentative',
    embed,
  );
  return true;
}

async function showTentativeCharacterSelect(
  interaction: ButtonInteraction,
  eventId: number,
  eventTitle: string,
  characters: import('@raid-ledger/contract').CharacterDto[],
  deps: SignupInteractionDeps,
  embed?: EmbedBuilder,
): Promise<void> {
  await showCharacterSelect(
    interaction,
    eventId,
    eventTitle,
    characters,
    deps,
    'tentative',
    embed,
  );
}

async function tentativeSingleCharacter(
  interaction: ButtonInteraction,
  eventId: number,
  userId: number,
  char: import('@raid-ledger/contract').CharacterDto,
  deps: SignupInteractionDeps,
): Promise<boolean> {
  const preferred = derivePreferredRoles(char);
  const result = await deps.signupsService.signup(
    eventId,
    userId,
    ...(preferred ? ([{ preferredRoles: preferred }] as const) : []),
  );
  await deps.signupsService.confirmSignup(eventId, result.id, userId, {
    characterId: char.id,
  });
  await deps.signupsService.updateStatus(
    eventId,
    { userId },
    { status: 'tentative' },
  );
  await interaction.editReply({
    content: `You're marked as **tentative** with **${char.name}**.${benchSuffix(result.assignedSlot)}`,
    embeds: [],
  });
  void deps.updateEmbedSignupCount(eventId);
  return true;
}

/** Check if event is MMO and redirect to role select for unlinked tentative. */
export async function tryMmoTentativeRedirect(
  interaction: ButtonInteraction,
  eventId: number,
  deps: SignupInteractionDeps,
): Promise<boolean> {
  const event = await fetchEvent(eventId, deps);
  const slotConfig = event?.slotConfig as Record<string, unknown> | null;
  if (slotConfig?.type !== 'mmo') return false;

  const embed = await buildReplyEmbed(eventId, deps);
  await showRoleSelect(
    interaction,
    eventId,
    deps,
    undefined,
    undefined,
    'tentative',
    embed,
  );
  return true;
}
