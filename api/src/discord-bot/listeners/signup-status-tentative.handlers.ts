import type { ButtonInteraction } from 'discord.js';
import { eq } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import { showRoleSelect } from './signup-signup.handlers';
import type { SignupInteractionDeps } from './signup-interaction.types';
import type { showCharacterSelect as ShowCharSelectFn } from '../utils/signup-dropdown-builders';
import { SIGNUP_BUTTON_IDS } from '../discord-bot.constants';

/** Fetch event by ID. */
export async function fetchEvent(
  eventId: number,
  deps: SignupInteractionDeps,
): Promise<typeof schema.events.$inferSelect | null> {
  const [event] = await deps.db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  return event ?? null;
}

/** Sign up as tentative. */
export async function signupAsTentative(
  eventId: number,
  userId: number,
  deps: SignupInteractionDeps,
): Promise<void> {
  await deps.signupsService.signup(eventId, userId);
  await deps.signupsService.updateStatus(
    eventId,
    { userId },
    { status: 'tentative' },
  );
  await deps.updateEmbedSignupCount(eventId);
}

/** Find linked user by Discord ID. */
export async function findLinkedUser(
  discordUserId: string,
  deps: SignupInteractionDeps,
): Promise<typeof schema.users.$inferSelect | null> {
  const [user] = await deps.db
    .select()
    .from(schema.users)
    .where(eq(schema.users.discordId, discordUserId))
    .limit(1);
  return user ?? null;
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

  await signupAsTentative(eventId, linkedUser.id, deps);
  await interaction.editReply({ content: "You're marked as **tentative**." });
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
};

/** Handle character-based tentative branch. Returns null if not applicable. */
async function tryTentativeCharPath(
  args: TentativeCharArgs,
): Promise<boolean | null> {
  const { interaction, eventId, event, ctx, deps } = args;
  if (shouldShowTentativeCharSelect(ctx.isMMO, ctx.characters.length)) {
    await showTentativeCharacterSelect(
      interaction,
      eventId,
      event.title,
      ctx.characters,
      deps,
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
  const charResult = await tryTentativeCharPath({
    interaction,
    eventId,
    userId: linkedUser.id,
    event,
    ctx,
    deps,
  });
  if (charResult !== null) return charResult;
  if (ctx.isMMO) {
    await showRoleSelect(
      interaction,
      eventId,
      deps,
      undefined,
      undefined,
      'tentative',
    );
    return true;
  }
  return false;
}

async function showTentativeCharacterSelect(
  interaction: ButtonInteraction,
  eventId: number,
  eventTitle: string,
  characters: import('@raid-ledger/contract').CharacterDto[],
  deps: SignupInteractionDeps,
): Promise<void> {
  const m = (await import('../utils/signup-dropdown-builders.js')) as {
    showCharacterSelect: typeof ShowCharSelectFn;
  };
  await m.showCharacterSelect(interaction, {
    customIdPrefix: SIGNUP_BUTTON_IDS.CHARACTER_SELECT,
    eventId,
    eventTitle,
    characters,
    emojiService: deps.emojiService,
    customIdSuffix: 'tentative',
  });
}

async function tentativeSingleCharacter(
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
  await deps.signupsService.updateStatus(
    eventId,
    { userId },
    { status: 'tentative' },
  );
  await interaction.editReply({
    content: `You're marked as **tentative** with **${char.name}**.`,
  });
  await deps.updateEmbedSignupCount(eventId);
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

  await showRoleSelect(
    interaction,
    eventId,
    deps,
    undefined,
    undefined,
    'tentative',
  );
  return true;
}
