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
