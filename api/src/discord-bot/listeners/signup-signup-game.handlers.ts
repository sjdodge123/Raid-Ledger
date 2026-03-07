import type { ButtonInteraction } from 'discord.js';
import { eq } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import { showCharacterSelect, showRoleSelect } from './signup-signup.handlers';
import type { SignupInteractionDeps } from './signup-interaction.types';

type NewSignupCtx = {
  game: { hasRoles: boolean };
  characters: import('@raid-ledger/contract').CharacterDto[];
  isMMO: boolean;
};

/** Load context needed for game-specific signup flows. */
export async function loadGameSignupContext(
  linkedUser: typeof schema.users.$inferSelect,
  event: typeof schema.events.$inferSelect,
  deps: SignupInteractionDeps,
): Promise<NewSignupCtx | null> {
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
  const slotConfig = event.slotConfig as Record<string, unknown> | null;
  return {
    game,
    characters: characterList.data,
    isMMO: slotConfig?.type === 'mmo',
  };
}

function shouldShowCharacterSelect(isMMO: boolean, charCount: number): boolean {
  return (isMMO && charCount >= 1) || charCount > 1;
}

type CharSignupArgs = {
  interaction: ButtonInteraction;
  eventId: number;
  userId: number;
  event: typeof schema.events.$inferSelect;
  ctx: NewSignupCtx;
  deps: SignupInteractionDeps;
};

/** Handle character-based signup branch (multi-char select or single char). */
async function tryCharacterSignupPath(
  args: CharSignupArgs,
): Promise<boolean | null> {
  const { interaction, eventId, event, ctx, deps } = args;
  if (shouldShowCharacterSelect(ctx.isMMO, ctx.characters.length)) {
    await showCharacterSelect(
      interaction,
      eventId,
      event.title,
      ctx.characters,
      deps,
    );
    return true;
  }
  if (ctx.characters.length === 1)
    return signupSingleCharacter(
      interaction,
      eventId,
      args.userId,
      ctx.characters[0],
      deps,
    );

  return null;
}

type GameSignupFlowArgs = {
  interaction: ButtonInteraction;
  eventId: number;
  linkedUser: typeof schema.users.$inferSelect;
  event: typeof schema.events.$inferSelect;
  deps: SignupInteractionDeps;
};

export async function tryGameSignupFlow(
  a: GameSignupFlowArgs,
): Promise<boolean> {
  const { interaction, eventId, linkedUser, event, deps } = a;
  const ctx = await loadGameSignupContext(linkedUser, event, deps);
  if (!ctx) return false;
  const uid = linkedUser.id;
  const charResult = await tryCharacterSignupPath({
    interaction,
    eventId,
    userId: uid,
    event,
    ctx,
    deps,
  });
  if (charResult !== null) return charResult;
  if (ctx.isMMO) {
    await showRoleSelect(interaction, eventId, deps);
    return true;
  }
  return signupWithoutCharacter({
    interaction,
    eventId,
    userId: uid,
    event,
    game: ctx.game,
    deps,
  });
}

async function signupSingleCharacter(
  interaction: ButtonInteraction,
  eventId: number,
  userId: number,
  char: import('@raid-ledger/contract').CharacterDto,
  deps: SignupInteractionDeps,
): Promise<boolean> {
  const result = await deps.signupsService.signup(eventId, userId);
  await deps.signupsService.confirmSignup(eventId, result.id, userId, {
    characterId: char.id,
  });
  await interaction.editReply({ content: `Signed up as **${char.name}**!` });
  await deps.updateEmbedSignupCount(eventId);
  return true;
}

interface NoCharSignupArgs {
  interaction: ButtonInteraction;
  eventId: number;
  userId: number;
  event: typeof schema.events.$inferSelect;
  game: { hasRoles: boolean };
  deps: SignupInteractionDeps;
}

async function signupWithoutCharacter(a: NoCharSignupArgs): Promise<boolean> {
  const { interaction, eventId, userId, event, game, deps } = a;
  await deps.signupsService.signup(eventId, userId);
  const clientUrl = process.env.CLIENT_URL ?? '';
  const nudge =
    game.hasRoles && clientUrl
      ? `\nTip: Create a character at ${clientUrl}/profile to get assigned to a role next time.`
      : '';
  await interaction.editReply({
    content: `You're signed up for **${event.title}**!${nudge}`,
  });
  await deps.updateEmbedSignupCount(eventId);
  return true;
}
