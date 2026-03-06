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
    await deps.signupsService.updateStatus(
      eventId,
      existingSignup.discordUserId
        ? { discordUserId: existingSignup.discordUserId }
        : { userId: existingSignup.user.id },
      { status: 'tentative' },
    );
    await interaction.editReply({ content: "You're marked as **tentative**." });
    await deps.updateEmbedSignupCount(eventId);
    return;
  }

  const [linkedUser] = await deps.db
    .select()
    .from(schema.users)
    .where(eq(schema.users.discordId, discordUserId))
    .limit(1);

  if (linkedUser) {
    await handleLinkedTentative(interaction, eventId, linkedUser, deps);
    return;
  }

  // Unlinked user — check for role selection on MMO events
  await handleUnlinkedTentative(interaction, eventId, discordUserId, deps);
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
  const [event] = await deps.db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);

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

  // No game or no character support — plain tentative signup
  await deps.signupsService.signup(eventId, linkedUser.id);
  await deps.signupsService.updateStatus(
    eventId,
    { userId: linkedUser.id },
    { status: 'tentative' },
  );
  await interaction.editReply({ content: "You're marked as **tentative**." });
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
  const slotConfig = event.slotConfig as Record<string, unknown> | null;

  if (slotConfig?.type === 'mmo' && characters.length >= 1) {
    const m = (await import('../utils/signup-dropdown-builders.js')) as {
      showCharacterSelect: typeof ShowCharSelectFn;
    };
    await m.showCharacterSelect(interaction, {
      customIdPrefix: SIGNUP_BUTTON_IDS.CHARACTER_SELECT,
      eventId,
      eventTitle: event.title,
      characters,
      emojiService: deps.emojiService,
      customIdSuffix: 'tentative',
    });
    return true;
  }

  if (characters.length > 1) {
    const m = (await import('../utils/signup-dropdown-builders.js')) as {
      showCharacterSelect: typeof ShowCharSelectFn;
    };
    await m.showCharacterSelect(interaction, {
      customIdPrefix: SIGNUP_BUTTON_IDS.CHARACTER_SELECT,
      eventId,
      eventTitle: event.title,
      characters,
      emojiService: deps.emojiService,
      customIdSuffix: 'tentative',
    });
    return true;
  }

  if (characters.length === 1) {
    const char = characters[0];
    const signupResult = await deps.signupsService.signup(
      eventId,
      linkedUser.id,
    );
    await deps.signupsService.confirmSignup(
      eventId,
      signupResult.id,
      linkedUser.id,
      { characterId: char.id },
    );
    await deps.signupsService.updateStatus(
      eventId,
      { userId: linkedUser.id },
      { status: 'tentative' },
    );
    await interaction.editReply({
      content: `You're marked as **tentative** with **${char.name}**.`,
    });
    await deps.updateEmbedSignupCount(eventId);
    return true;
  }

  if (slotConfig?.type === 'mmo') {
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

/**
 * Tentative flow for unlinked Discord users.
 */
async function handleUnlinkedTentative(
  interaction: ButtonInteraction,
  eventId: number,
  discordUserId: string,
  deps: SignupInteractionDeps,
): Promise<void> {
  const [event] = await deps.db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);

  if (event) {
    const slotConfig = event.slotConfig as Record<string, unknown> | null;
    if (slotConfig?.type === 'mmo') {
      await showRoleSelect(
        interaction,
        eventId,
        deps,
        undefined,
        undefined,
        'tentative',
      );
      return;
    }
  }

  await deps.signupsService.signupDiscord(eventId, {
    discordUserId,
    discordUsername: interaction.user.username,
    discordAvatarHash: interaction.user.avatar,
    status: 'tentative',
  });

  await interaction.editReply({ content: "You're marked as **tentative**." });
  await deps.updateEmbedSignupCount(eventId);
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
    await interaction.editReply({ content: "You've **declined** this event." });
    await deps.updateEmbedSignupCount(eventId);
    return;
  }

  const [linkedUser] = await deps.db
    .select()
    .from(schema.users)
    .where(eq(schema.users.discordId, discordUserId))
    .limit(1);

  if (linkedUser) {
    await deps.signupsService.signup(eventId, linkedUser.id);
    await deps.signupsService.updateStatus(
      eventId,
      { userId: linkedUser.id },
      { status: 'declined' },
    );
  } else {
    await deps.signupsService.signupDiscord(eventId, {
      discordUserId,
      discordUsername: interaction.user.username,
      discordAvatarHash: interaction.user.avatar,
      status: 'declined',
    });
  }

  await interaction.editReply({ content: "You've **declined** this event." });
  await deps.updateEmbedSignupCount(eventId);
}

/**
 * Handle Quick Sign Up for anonymous Discord participants (Path B).
 */
export async function handleQuickSignup(
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
    await interaction.editReply({ content: "You're already signed up!" });
    return;
  }

  const [event] = await deps.db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);

  if (!event) {
    await interaction.editReply({ content: 'Event not found.' });
    return;
  }

  const slotConfig = event.slotConfig as Record<string, unknown> | null;
  if (slotConfig?.type === 'mmo') {
    await showRoleSelect(interaction, eventId, deps);
    return;
  }

  await deps.signupsService.signupDiscord(eventId, {
    discordUserId,
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
  const [event] = await deps.db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);

  if (!event) {
    await interaction.editReply({ content: 'Event not found.' });
    return;
  }

  const clientUrl = process.env.CLIENT_URL ?? '';
  const intentToken = deps.intentTokenService.generate(
    eventId,
    interaction.user.id,
  );
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

  await interaction.editReply({
    content: [
      `**Sign up for ${event.title}**`,
      '',
      'Create a Raid Ledger account to manage characters,',
      'get reminders, and track your raid history.',
    ].join('\n'),
    components: [row],
  });
}
