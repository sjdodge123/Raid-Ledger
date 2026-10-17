/**
 * ROK-1768 — the `/bind purpose:` option: parsing, the pre-write validation an
 * explicit purpose gets, and the reply for a bind the service refused.
 *
 * Kept out of `bind.command.ts` so that file stays under the 300-line cap.
 */
import {
  classifyBindingTriple,
  quickPlayGameTakenMessage,
  type ChannelType as BindingChannelType,
} from '@raid-ledger/contract';
import type { ChatInputCommandInteraction } from 'discord.js';

/** The text-channel purposes `/bind` lets a caller choose explicitly. */
export type ExplicitTextPurpose =
  'game-announcements' | 'quick-play-announcements';

const EXPLICIT_PURPOSES: readonly ExplicitTextPurpose[] = [
  'game-announcements',
  'quick-play-announcements',
];

/** Refusal for `/bind event:… purpose:…` — the event path never reads it. */
export const PURPOSE_WITH_EVENT_ERROR =
  '`purpose` applies to channel binds, not `/bind event`.';

/** Refusal for a Quick Play bind scoped to a series (decision 2). */
export const QP_WITH_SERIES_ERROR =
  'Quick Play Announcements bind to a game, not a series — drop the series option.';

function isExplicitPurpose(value: string): value is ExplicitTextPurpose {
  return EXPLICIT_PURPOSES.some((p) => p === value);
}

/**
 * Read the `purpose` option.
 *
 * @param interaction - The `/bind` interaction.
 * @returns The chosen purpose, or null when absent or not a known choice.
 */
export function parsePurposeOption(
  interaction: Pick<ChatInputCommandInteraction, 'options'>,
): ExplicitTextPurpose | null {
  const raw = interaction.options.getString('purpose');
  return raw && isExplicitPurpose(raw) ? raw : null;
}

/**
 * Validate an explicit purpose before anything is written, with the same
 * classifier the admin API uses.
 *
 * @returns The refusal sentence, or null when the bind may proceed.
 */
export function explicitPurposeError(p: {
  purpose: ExplicitTextPurpose;
  channelType: BindingChannelType;
  gameId: number | null;
  hasSeries: boolean;
}): string | null {
  if (p.purpose === 'quick-play-announcements' && p.hasSeries) {
    return QP_WITH_SERIES_ERROR;
  }
  return (
    classifyBindingTriple(p.channelType, p.purpose, p.gameId)?.message ?? null
  );
}

/**
 * Read and validate the `purpose` option before any write (ROK-1768). Runs
 * after the ROK-1628 permission check, like `resolveGame` / `resolveSeries`.
 *
 * @returns The explicit purpose, null when none was chosen, or false when the
 *   caller has already been told why the bind is refused.
 */
export async function resolvePurpose(
  interaction: Pick<ChatInputCommandInteraction, 'options' | 'editReply'>,
  ch: { bindingChannelType: BindingChannelType },
  game: { id: number } | null,
  series: { id: string } | null,
): Promise<ExplicitTextPurpose | null | false> {
  const purpose = parsePurposeOption(interaction);
  if (!purpose) return null;
  const refusal = explicitPurposeError({
    purpose,
    channelType: ch.bindingChannelType,
    gameId: game?.id ?? null,
    hasSeries: series !== null,
  });
  if (!refusal) return purpose;
  await interaction.editReply(refusal);
  return false;
}

function responseOf(err: unknown): Record<string, unknown> | null {
  if (typeof err !== 'object' || err === null || !('getResponse' in err)) {
    return null;
  }
  const { getResponse } = err;
  if (typeof getResponse !== 'function') return null;
  const body: unknown = getResponse.call(err);
  return typeof body === 'object' && body !== null
    ? Object.fromEntries(Object.entries(body))
    : null;
}

/**
 * The reply for a bind the service threw on.
 *
 * A 409 BINDING_QP_GAME_TAKEN carries no `errors[]`, only the existing
 * binding's `channelId`, so name that channel; any other HttpException
 * surfaces its first guard sentence (ROK-1415).
 *
 * @returns The sentence, or null to fall back to the generic one.
 */
export function bindErrorReply(err: unknown): string | null {
  const body = responseOf(err);
  if (!body) return null;
  const { code, channelId, errors } = body;
  if (code === 'BINDING_QP_GAME_TAKEN' && typeof channelId === 'string') {
    return quickPlayGameTakenMessage(`<#${channelId}>`);
  }
  if (Array.isArray(errors)) {
    const first: unknown = errors[0];
    if (typeof first === 'string') return first;
  }
  return null;
}
