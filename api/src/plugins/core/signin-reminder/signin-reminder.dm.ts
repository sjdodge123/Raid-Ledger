/**
 * ROK-2284 — the reminder DM (ruled Q4/Q7): "type /login" text, an
 * "Open Raid Ledger" link button to the site and the stop button. No sign-in
 * token in the DM — a 15-minute link would sit expired in DM history.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import {
  createDmEmbed,
  type DmEmbed,
} from '../../../discord-bot/embeds/embed-chrome.helpers';
import {
  SIGNIN_REMINDER_BUTTON_IDS,
  SIGNIN_REMINDER_STOP_LABEL,
} from './signin-reminder.constants';

export interface SigninReminderDm {
  embed: DmEmbed;
  row: ActionRowBuilder<ButtonBuilder>;
}

/** The reminder body; `communityName` null ⇒ "This community". */
export function signinReminderText(communityName: string | null): string {
  const who = communityName?.trim() ? communityName.trim() : 'This community';
  return (
    `👋 ${who} uses Raid Ledger for events and sign-ups. ` +
    'Type **/login** in any channel to get a private sign-in link — no Discord password needed.'
  );
}

/** Embed + one action row: [Open Raid Ledger (link)] [Don't remind me again]. */
export function buildSigninReminderDm(
  communityName: string | null,
  clientUrl: string,
): SigninReminderDm {
  const embed = createDmEmbed({
    state: 'announcing',
    communityName,
    timestamp: false,
  }).setDescription(signinReminderText(communityName));
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('Open Raid Ledger')
      .setURL(clientUrl),
    new ButtonBuilder()
      .setStyle(ButtonStyle.Secondary)
      .setCustomId(SIGNIN_REMINDER_BUTTON_IDS.STOP)
      .setLabel(SIGNIN_REMINDER_STOP_LABEL),
  );
  return { embed, row };
}
