import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { aiCustomId } from '../ai-chat.constants';
import type { ButtonDef } from '../tree/tree.types';

/** Map style strings to discord.js ButtonStyle enum values. */
function resolveStyle(style?: ButtonDef['style']): ButtonStyle {
  switch (style) {
    case 'primary':
      return ButtonStyle.Primary;
    case 'success':
      return ButtonStyle.Success;
    case 'danger':
      return ButtonStyle.Danger;
    case 'link':
      return ButtonStyle.Link;
    default:
      return ButtonStyle.Secondary;
  }
}

/** Build the top-level welcome menu (5 buttons for members, 6 for operators). */
export function buildWelcomeMenu(
  isOperator: boolean,
): ActionRowBuilder<ButtonBuilder>[] {
  const buttons: ButtonDef[] = [
    { customId: aiCustomId('events'), label: 'Events', style: 'primary' },
    {
      customId: aiCustomId('my-signups'),
      label: 'My Signups',
      style: 'primary',
    },
    {
      customId: aiCustomId('game-library'),
      label: 'Game Library',
      style: 'primary',
    },
    { customId: aiCustomId('lineup'), label: 'Lineup', style: 'primary' },
    { customId: aiCustomId('polls'), label: 'Polls', style: 'primary' },
  ];
  if (isOperator) {
    buttons.push({
      customId: aiCustomId('stats'),
      label: 'Stats',
      style: 'danger',
    });
  }
  return buildButtonRows(buttons);
}

/** Build rows of buttons from an array of ButtonDef. Max 5 per row. */
export function buildButtonRows(
  buttons: ButtonDef[],
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < buttons.length; i += 5) {
    const chunk = buttons.slice(i, i + 5);
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const btn of chunk) {
      row.addComponents(buildSingleButton(btn));
    }
    rows.push(row);
  }
  return rows;
}

/** Build a single ButtonBuilder from a ButtonDef. */
function buildSingleButton(btn: ButtonDef): ButtonBuilder {
  const builder = new ButtonBuilder().setLabel(btn.label);
  if (btn.style === 'link' && btn.url) {
    builder.setStyle(ButtonStyle.Link).setURL(btn.url);
  } else {
    builder.setCustomId(btn.customId).setStyle(resolveStyle(btn.style));
  }
  return builder;
}

/** Build back + home navigation row. */
export function buildNavRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(aiCustomId('back'))
      .setLabel('Back')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(aiCustomId('home'))
      .setLabel('Home')
      .setStyle(ButtonStyle.Secondary),
  );
}
