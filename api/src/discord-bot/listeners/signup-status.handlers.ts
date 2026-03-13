import type { ButtonInteraction } from 'discord.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import * as schema from '../../drizzle/schema';
import { SIGNUP_BUTTON_IDS } from '../discord-bot.constants';
import { findLinkedUser, fetchEvent } from './signup-interaction.helpers';
import { showRoleSelect } from './signup-signup.handlers';
import type { SignupInteractionDeps } from './signup-interaction.types';
import {
  handleLinkedTentative,
  tryMmoTentativeRedirect,
} from './signup-status-tentative.handlers';
import { benchSuffix } from './signup-bench-feedback.helpers';
import { buildReplyEmbed } from './signup-reply-embed.helpers';

type ExistingSignup = NonNullable<
  Awaited<
    ReturnType<SignupInteractionDeps['signupsService']['findByDiscordUser']>
  >
>;

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
  existingSignup: ExistingSignup,
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

  const result = await deps.signupsService.signupDiscord(eventId, {
    discordUserId,
    discordUsername: interaction.user.username,
    discordAvatarHash: interaction.user.avatar,
    status: 'tentative',
  });
  await interaction.editReply({
    content: `You're marked as **tentative**.${benchSuffix(result.assignedSlot)}`,
  });
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
  if (await tryMmoQuickSignupRedirect(interaction, eventId, event, deps))
    return;
  await quickSignupAnonymous(interaction, eventId, deps);
}

async function tryMmoQuickSignupRedirect(
  interaction: ButtonInteraction,
  eventId: number,
  event: typeof schema.events.$inferSelect,
  deps: SignupInteractionDeps,
): Promise<boolean> {
  const slotConfig = event.slotConfig as Record<string, unknown> | null;
  if (slotConfig?.type !== 'mmo') return false;
  const embed = await buildReplyEmbed(eventId, deps);
  await showRoleSelect(
    interaction,
    eventId,
    deps,
    undefined,
    undefined,
    undefined,
    embed,
  );
  return true;
}

async function quickSignupAnonymous(
  interaction: ButtonInteraction,
  eventId: number,
  deps: SignupInteractionDeps,
): Promise<void> {
  const result = await deps.signupsService.signupDiscord(eventId, {
    discordUserId: interaction.user.id,
    discordUsername: interaction.user.username,
    discordAvatarHash: interaction.user.avatar,
  });

  const clientUrl = process.env.CLIENT_URL ?? '';
  const accountLink = clientUrl
    ? `\n[Create an account](${clientUrl}) to manage characters and get reminders.`
    : '';
  await interaction.editReply({
    content: `You're signed up as **${interaction.user.username}**!${benchSuffix(result.assignedSlot)}${accountLink}`,
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
