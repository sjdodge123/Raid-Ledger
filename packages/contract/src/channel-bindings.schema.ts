import { z } from 'zod';

export const BindingPurposeEnum = z.enum([
  'game-announcements',
  'game-voice-monitor',
  'general-lobby',
]);

export const ChannelTypeEnum = z.enum(['text', 'voice']);

export const ChannelBindingConfigSchema = z.object({
  minPlayers: z.number().int().min(1).optional(),
  autoClose: z.boolean().optional(),
  gracePeriod: z.number().int().min(0).optional(),
  notificationChannelId: z.string().optional(),
  allowJustChatting: z.boolean().optional(),
});

export const ChannelBindingSchema = z.object({
  id: z.string().uuid(),
  guildId: z.string(),
  channelId: z.string(),
  channelName: z.string().optional(),
  channelType: ChannelTypeEnum,
  bindingPurpose: BindingPurposeEnum,
  gameId: z.number().int().nullable(),
  gameName: z.string().nullable().optional(),
  /** Series (recurrence group) this binding scopes to; null for game/global bindings (ROK-1351). */
  recurrenceGroupId: z.string().uuid().nullable().optional(),
  config: ChannelBindingConfigSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ChannelBindingListSchema = z.object({
  data: z.array(ChannelBindingSchema),
});

export const CreateChannelBindingSchema = z.object({
  channelId: z.string().min(1),
  channelType: ChannelTypeEnum,
  bindingPurpose: BindingPurposeEnum,
  gameId: z.number().int().nullable().optional(),
  config: ChannelBindingConfigSchema.optional(),
});

export const UpdateChannelBindingSchema = z.object({
  config: ChannelBindingConfigSchema.optional(),
  bindingPurpose: BindingPurposeEnum.optional(),
});

export type BindingPurpose = z.infer<typeof BindingPurposeEnum>;
export type ChannelType = z.infer<typeof ChannelTypeEnum>;
export type ChannelBindingConfig = z.infer<typeof ChannelBindingConfigSchema>;
export type ChannelBindingDto = z.infer<typeof ChannelBindingSchema>;
export type ChannelBindingListDto = z.infer<typeof ChannelBindingListSchema>;
export type CreateChannelBindingDto = z.infer<typeof CreateChannelBindingSchema>;
export type UpdateChannelBindingDto = z.infer<typeof UpdateChannelBindingSchema>;

// ─── ROK-1415: (channelType, bindingPurpose, gameId) invariant ──────────────
// A (voice, game-voice-monitor, gameId=NULL) triple makes Quick Play
// permanently inert. This is the single source of truth for the invariant,
// shared by the API service guard and the admin web form so they cannot drift.

/** A rejected binding triple: which rule broke, which field to blame, and why. */
export type BindingTripleViolation = {
  code: 'BINDING_MONITOR_REQUIRES_GAME' | 'BINDING_PURPOSE_WRONG_CHANNEL_TYPE';
  field: 'gameId' | 'bindingPurpose';
  message: string;
};

/**
 * Classify a merged post-write binding triple. Returns null when legal.
 * `gameId` is tested with `!= null`, NEVER truthiness — gameId 0 is a real game.
 * The rule is deliberately narrow: (voice, general-lobby, <any gameId>) stays
 * legal because a lobby resolves its game from presence at join time and
 * rejecting a live prod shape would convert a hygiene fix into an outage.
 */
export function classifyBindingTriple(
  channelType: ChannelType,
  bindingPurpose: BindingPurpose,
  gameId: number | null | undefined,
): BindingTripleViolation | null {
  if (channelType === 'voice') {
    if (bindingPurpose === 'game-announcements') {
      return wrongChannelType(channelType, bindingPurpose);
    }
    if (bindingPurpose === 'game-voice-monitor' && gameId == null) {
      return {
        code: 'BINDING_MONITOR_REQUIRES_GAME',
        field: 'gameId',
        message:
          'A Game Voice Monitor binding must have a game. Pick a game, or ' +
          'change the purpose to General Lobby (which auto-detects the game ' +
          'from Discord Rich Presence).',
      };
    }
    return null;
  }
  // text channels only carry announcements
  if (bindingPurpose === 'game-announcements') return null;
  return wrongChannelType(channelType, bindingPurpose);
}

function wrongChannelType(
  channelType: ChannelType,
  bindingPurpose: BindingPurpose,
): BindingTripleViolation {
  return {
    code: 'BINDING_PURPOSE_WRONG_CHANNEL_TYPE',
    field: 'bindingPurpose',
    message:
      `A ${channelType} channel cannot use the '${bindingPurpose}' purpose. ` +
      'Text channels use Game Announcements; voice channels use Game Voice ' +
      'Monitor or General Lobby.',
  };
}

/** Canonical derivation. `!= null`, NOT truthiness — gameId 0 is a real game. */
export function deriveBindingPurpose(
  channelType: ChannelType,
  gameId: number | null | undefined,
): BindingPurpose {
  return channelType === 'voice'
    ? gameId != null
      ? 'game-voice-monitor'
      : 'general-lobby'
    : 'game-announcements';
}
