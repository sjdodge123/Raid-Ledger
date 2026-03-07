import type { ButtonInteraction } from 'discord.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { eq } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import { SIGNUP_BUTTON_IDS } from '../discord-bot.constants';
import { showRoleSelect } from './signup-signup.handlers';
import type { SignupInteractionDeps } from './signup-interaction.types';
import type { showCharacterSelect as ShowCharSelectFn } from '../utils/signup-dropdown-builders';

/**
 * Handle the Tentative button click.
 */
export async function handleTentative(
  interaction: ButtonInteraction,
  eventId: number,
  deps: SignupInteractionDeps,
): Promise<void> {
  const discordUserId = interaction.user.id;
  const existingSignup = await deps.signupsService.findByDiscordUser(
    eventId,
    discordUserId,
  );

  if (existingSignup) {
    await markExistingTentative(eventId, existingSignup, deps);
    await interaction.editReply({ content: "You're marked as **tentative**." });
    await deps.updateEmbedSignupCount(eventId);
    return;
  }

  const linkedUser = await findLinkedUser(discordUserId, deps);
  if (linkedUser) {
    await handleLinkedTentative(interaction, eventId, linkedUser, deps);
    return;
  }

  await handleUnlinkedTentative(interaction, eventId, discordUserId, deps);
}

async function markExistingTentative(
  eventId: number,
  existingSignup: NonNullable<
    Awaited<
      ReturnType<SignupInteractionDeps['signupsService']['findByDiscordUser']>
    >
  >,
  deps: SignupInteractionDeps,
): Promise<void> {
  await deps.signupsService.updateStatus(
    eventId,
    existingSignup.discordUserId
      ? { discordUserId: existingSignup.discordUserId }
      : { userId: existingSignup.user.id },
    { status: 'tentative' },
  );
}

async function findLinkedUser(
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

/**
 * Tentative flow for a linked user without an existing signup.
 */
async function handleLinkedTentative(
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
    const handled = await tryLinkedTentativeGameFlow(
      interaction,
      eventId,
      linkedUser,
      event,
      deps,
    );
    if (handled) return;
  }

  await signupAsTentative(eventId, linkedUser.id, deps);
  await interaction.editReply({ content: "You're marked as **tentative**." });
}

async function fetchEvent(
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

async function signupAsTentative(
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

/**
 * Try game-specific tentative flow for linked user. Returns true if handled.
 */
async function tryLinkedTentativeGameFlow(
  interaction: ButtonInteraction,
  eventId: number,
  linkedUser: typeof schema.users.$inferSelect,
  event: typeof schema.events.$inferSelect,
  deps: SignupInteractionDeps,
): Promise<boolean> {
  const [game] = await deps.db
    .select()
    .from(schema.games)
    .where(eq(schema.games.id, event.gameId!))
    .limit(1);
  if (!game) return false;

  const characterList = await deps.charactersService.findAllForUser(
    linkedUser.id,
    event.gameId!,
  );
  const characters = characterList.data;
  const isMMO =
    (event.slotConfig as Record<string, unknown> | null)?.type === 'mmo';

  if ((isMMO && characters.length >= 1) || characters.length > 1) {
    await showTentativeCharacterSelect(
      interaction,
      eventId,
      event.title,
      characters,
      deps,
    );
    return true;
  }

  if (characters.length === 1) {
    return tentativeSingleCharacter(
      interaction,
      eventId,
      linkedUser.id,
      characters[0],
      deps,
    );
  }

  if (isMMO) {
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

/**
 * Tentative flow for unlinked Discord users.
 */
async function handleUnlinkedTentative(
  interaction: ButtonInteraction,
  eventId: number,
  discordUserId: string,
  deps: SignupInteractionDeps,
): Promise<void> {
  if (await tryMmoTentativeRedirect(interaction, eventId, deps)) return;

  await deps.signupsService.signupDiscord(eventId, {
    discordUserId,
    discordUsername: interaction.user.username,
    discordAvatarHash: interaction.user.avatar,
    status: 'tentative',
  });
  await interaction.editReply({ content: "You're marked as **tentative**." });
  await deps.updateEmbedSignupCount(eventId);
}

async function tryMmoTentativeRedirect(
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

/**
 * Handle the Decline button click.
 */
export async function handleDecline(
  interaction: ButtonInteraction,
  eventId: number,
  deps: SignupInteractionDeps,
): Promise<void> {
  const discordUserId = interaction.user.id;
  const existingSignup = await deps.signupsService.findByDiscordUser(
    eventId,
    discordUserId,
  );

  if (existingSignup) {
    await deps.signupsService.cancelByDiscordUser(eventId, discordUserId);
  } else {
    await createDeclinedSignup(interaction, eventId, deps);
  }

  await interaction.editReply({ content: "You've **declined** this event." });
  await deps.updateEmbedSignupCount(eventId);
}

async function createDeclinedSignup(
  interaction: ButtonInteraction,
  eventId: number,
  deps: SignupInteractionDeps,
): Promise<void> {
  const linkedUser = await findLinkedUser(interaction.user.id, deps);

  if (linkedUser) {
    await deps.signupsService.signup(eventId, linkedUser.id);
    await deps.signupsService.updateStatus(
      eventId,
      { userId: linkedUser.id },
      { status: 'declined' },
    );
  } else {
    await deps.signupsService.signupDiscord(eventId, {
      discordUserId: interaction.user.id,
      discordUsername: interaction.user.username,
      discordAvatarHash: interaction.user.avatar,
      status: 'declined',
    });
  }
}

/**
 * Handle Quick Sign Up for anonymous Discord participants (Path B).
 */
export async function handleQuickSignup(
  interaction: ButtonInteraction,
  eventId: number,
  deps: SignupInteractionDeps,
): Promise<void> {
  const existing = await deps.signupsService.findByDiscordUser(
    eventId,
    interaction.user.id,
  );
  if (existing) {
    await interaction.editReply({ content: "You're already signed up!" });
    return;
  }

  const event = await fetchEvent(eventId, deps);
  if (!event) {
    await interaction.editReply({ content: 'Event not found.' });
    return;
  }

  if ((event.slotConfig as Record<string, unknown> | null)?.type === 'mmo') {
    await showRoleSelect(interaction, eventId, deps);
    return;
  }

  await quickSignupAnonymous(interaction, eventId, deps);
}

async function quickSignupAnonymous(
  interaction: ButtonInteraction,
  eventId: number,
  deps: SignupInteractionDeps,
): Promise<void> {
  await deps.signupsService.signupDiscord(eventId, {
    discordUserId: interaction.user.id,
    discordUsername: interaction.user.username,
    discordAvatarHash: interaction.user.avatar,
  });

  const clientUrl = process.env.CLIENT_URL ?? '';
  const accountLink = clientUrl
    ? `\n[Create an account](${clientUrl}) to manage characters and get reminders.`
    : '';
  await interaction.editReply({
    content: `You're signed up as **${interaction.user.username}**!${accountLink}`,
  });
  await deps.updateEmbedSignupCount(eventId);
}

/**
 * Show onboarding ephemeral for unlinked Discord users (ROK-137).
 */
export async function showOnboardingEphemeral(
  interaction: ButtonInteraction,
  eventId: number,
  deps: SignupInteractionDeps,
): Promise<void> {
  const event = await fetchEvent(eventId, deps);
  if (!event) {
    await interaction.editReply({ content: 'Event not found.' });
    return;
  }

  const row = buildOnboardingRow(eventId, interaction.user.id, deps);
  await interaction.editReply({
    content: buildOnboardingText(event.title),
    components: [row],
  });
}

function buildOnboardingRow(
  eventId: number,
  discordUserId: string,
  deps: SignupInteractionDeps,
): ActionRowBuilder<ButtonBuilder> {
  const clientUrl = process.env.CLIENT_URL ?? '';
  const intentToken = deps.intentTokenService.generate(eventId, discordUserId);
  const joinUrl = clientUrl
    ? `${clientUrl}/join?intent=signup&eventId=${eventId}&token=${encodeURIComponent(intentToken)}`
    : null;

  const row = new ActionRowBuilder<ButtonBuilder>();
  if (joinUrl) {
    row.addComponents(
      new ButtonBuilder()
        .setLabel('Join & Sign Up')
        .setStyle(ButtonStyle.Link)
        .setURL(joinUrl),
    );
  }
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`${SIGNUP_BUTTON_IDS.QUICK_SIGNUP}:${eventId}`)
      .setLabel('Quick Sign Up')
      .setStyle(ButtonStyle.Secondary),
  );
  return row;
}

function buildOnboardingText(eventTitle: string): string {
  return [
    `**Sign up for ${eventTitle}**`,
    '',
    'Create a Raid Ledger account to manage characters,',
    'get reminders, and track your raid history.',
  ].join('\n');
}
