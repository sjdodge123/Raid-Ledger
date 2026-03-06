import { eq } from 'drizzle-orm';
import type { ButtonInteraction } from 'discord.js';
import * as schema from '../../drizzle/schema';
import { RESCHEDULE_BUTTON_IDS } from '../discord-bot.constants';
import {
  showCharacterSelect,
  showRoleSelect,
} from '../utils/signup-dropdown-builders';
import type { EventRow, RescheduleDeps } from './reschedule-response.helpers';
import { reconfirmSignup } from './reschedule-roster.handlers';

/** Context for a confirm/tentative button handler. */
interface ConfirmCtx {
  deps: RescheduleDeps;
  interaction: ButtonInteraction;
  event: EventRow;
  editDm: (
    i: ButtonInteraction,
    s: 'confirmed' | 'tentative' | 'declined',
  ) => Promise<void>;
}

/** Handle confirm for a linked user. */
export async function handleLinkedConfirm(
  ctx: ConfirmCtx,
  linkedUser: { id: number },
): Promise<void> {
  const chars = await resolveCharacters(ctx.deps, ctx.event, linkedUser);
  if (!chars) {
    await finalizeQuick(ctx, linkedUser.id, 'signed_up');
    return;
  }
  if (shouldShowCharSelect(chars.slotConfig, chars.characters)) {
    await showCharSelect(ctx, chars.characters);
    return;
  }
  if (chars.characters.length === 1) {
    await finalizeSingleChar(
      ctx,
      linkedUser.id,
      chars.characters[0],
      'signed_up',
    );
    return;
  }
  if (chars.slotConfig?.type === 'mmo') {
    await showMmoRole(ctx, 'Confirming as');
    return;
  }
  await finalizeQuick(ctx, linkedUser.id, 'signed_up');
}

/** Handle confirm for an unlinked user. */
export async function handleUnlinkedConfirm(ctx: ConfirmCtx): Promise<void> {
  const sc = ctx.event.slotConfig as Record<string, unknown> | null;
  if (sc?.type === 'mmo') {
    await showMmoRole(ctx, 'Confirming as');
    return;
  }
  await reconfirmSignup(ctx.deps, ctx.interaction, ctx.event);
  await ctx.interaction.editReply({
    content: `You're confirmed for **${ctx.event.title}**.`,
  });
  await ctx.editDm(ctx.interaction, 'confirmed');
  await ctx.deps.embedSyncQueue.enqueue(ctx.event.id, 'reschedule-confirm');
}

/** Handle tentative for a linked user. */
export async function handleLinkedTentative(
  ctx: ConfirmCtx,
  linkedUser: { id: number },
): Promise<void> {
  const chars = await resolveCharacters(ctx.deps, ctx.event, linkedUser);
  if (!chars) {
    await finalizeQuick(ctx, linkedUser.id, 'tentative');
    return;
  }
  if (shouldShowCharSelect(chars.slotConfig, chars.characters)) {
    await showCharSelect(ctx, chars.characters, 'tentative');
    return;
  }
  if (chars.characters.length === 1) {
    await finalizeSingleChar(
      ctx,
      linkedUser.id,
      chars.characters[0],
      'tentative',
    );
    return;
  }
  if (chars.slotConfig?.type === 'mmo') {
    await showMmoRole(ctx, 'Tentative as', 'tentative');
    return;
  }
  await finalizeQuick(ctx, linkedUser.id, 'tentative');
}

/** Handle tentative for an unlinked user. */
export async function handleUnlinkedTentative(ctx: ConfirmCtx): Promise<void> {
  const sc = ctx.event.slotConfig as Record<string, unknown> | null;
  if (sc?.type === 'mmo') {
    await showMmoRole(ctx, 'Tentative as', 'tentative');
    return;
  }
  await reconfirmSignup(ctx.deps, ctx.interaction, ctx.event, undefined, {
    signupStatus: 'tentative',
  });
  await ctx.interaction.editReply({
    content: `You're marked as **tentative** for **${ctx.event.title}**.`,
  });
  await ctx.editDm(ctx.interaction, 'tentative');
  await ctx.deps.embedSyncQueue.enqueue(ctx.event.id, 'reschedule-tentative');
}

// ─── Internal helpers ───────────────────────────────────────────────

function shouldShowCharSelect(
  sc: Record<string, unknown> | null,
  chars: { id: string; name: string }[],
): boolean {
  if (sc?.type === 'mmo' && chars.length >= 1) return true;
  return chars.length > 1;
}

async function resolveCharacters(
  deps: RescheduleDeps,
  event: EventRow,
  linkedUser: { id: number },
): Promise<{
  characters: { id: string; name: string }[];
  slotConfig: Record<string, unknown> | null;
} | null> {
  if (!event.gameId) return null;
  const [game] = await deps.db
    .select()
    .from(schema.games)
    .where(eq(schema.games.id, event.gameId))
    .limit(1);
  if (!game) return null;
  const list = await deps.charactersService.findAllForUser(
    linkedUser.id,
    event.gameId,
  );
  return {
    characters: list.data,
    slotConfig: event.slotConfig as Record<string, unknown> | null,
  };
}

async function showCharSelect(
  ctx: ConfirmCtx,
  characters: { id: string; name: string }[],
  suffix?: string,
): Promise<void> {
  await showCharacterSelect(ctx.interaction, {
    customIdPrefix: RESCHEDULE_BUTTON_IDS.CHARACTER_SELECT,
    eventId: ctx.event.id,
    eventTitle: ctx.event.title,
    characters,
    emojiService: ctx.deps.emojiService,
    customIdSuffix: suffix,
  });
}

async function showMmoRole(
  ctx: ConfirmCtx,
  verb: string,
  suffix?: string,
): Promise<void> {
  await showRoleSelect(ctx.interaction, {
    customIdPrefix: RESCHEDULE_BUTTON_IDS.ROLE_SELECT,
    eventId: ctx.event.id,
    emojiService: ctx.deps.emojiService,
    characterVerb: verb,
    customIdSuffix: suffix,
  });
}

async function finalizeQuick(
  ctx: ConfirmCtx,
  userId: number,
  mode: 'signed_up' | 'tentative',
): Promise<void> {
  const isTentative = mode === 'tentative';
  const opts = isTentative ? { signupStatus: 'tentative' as const } : undefined;
  await reconfirmSignup(ctx.deps, ctx.interaction, ctx.event, userId, opts);
  const label = isTentative ? 'marked as **tentative**' : 'confirmed';
  await ctx.interaction.editReply({
    content: `You're ${label} for **${ctx.event.title}**.`,
  });
  const state = isTentative ? 'tentative' : 'confirmed';
  await ctx.editDm(ctx.interaction, state);
  const trigger = isTentative ? 'reschedule-tentative' : 'reschedule-confirm';
  await ctx.deps.embedSyncQueue.enqueue(ctx.event.id, trigger);
}

async function finalizeSingleChar(
  ctx: ConfirmCtx,
  userId: number,
  char: { id: string; name: string },
  mode: 'signed_up' | 'tentative',
): Promise<void> {
  const isTentative = mode === 'tentative';
  await reconfirmSignup(ctx.deps, ctx.interaction, ctx.event, userId, {
    characterId: char.id,
    signupStatus: isTentative ? 'tentative' : undefined,
  });
  const label = isTentative ? 'marked as **tentative**' : 'confirmed';
  await ctx.interaction.editReply({
    content: `You're ${label} for **${ctx.event.title}** with **${char.name}**.`,
  });
  const state = isTentative ? 'tentative' : 'confirmed';
  await ctx.editDm(ctx.interaction, state);
  const trigger = isTentative ? 'reschedule-tentative' : 'reschedule-confirm';
  await ctx.deps.embedSyncQueue.enqueue(ctx.event.id, trigger);
}
