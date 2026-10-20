import { z } from 'zod';

/**
 * ROK-1870 — game community hubs: a third hub kind for games with no Pelican
 * server and no WoW guild. Members propose one from the game page, an admin
 * approves it, the proposer leads it, anyone in the Discord guild can Join.
 * Additive; every list/page schema here is a new endpoint's payload.
 */

const id = z.number().int().positive();
const isoDate = z.iso.datetime({ offset: true });

export const HUB_NAME_MIN = 3;
export const HUB_NAME_MAX = 64;
export const HUB_BLURB_MAX = 280;
export const HUB_BAN_REASON_MAX = 200;
export const HUB_REJECT_REASON_MAX = 500;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** 3–64 chars, no control characters, at least one letter or digit. */
export const HubNameSchema = z
  .string()
  .trim()
  .min(HUB_NAME_MIN)
  .max(HUB_NAME_MAX)
  .refine((v) => !CONTROL_CHARS.test(v), { message: 'Hub name cannot contain control characters' })
  .refine((v) => HAS_LETTER_OR_DIGIT.test(v), { message: 'Hub name needs at least one letter or digit' });

const BlurbSchema = z.string().trim().min(1).max(HUB_BLURB_MAX);

const UserRefSchema = z
  .object({ userId: id, username: z.string(), avatarUrl: z.string().nullable() })
  .strict();
export type HubUserRef = z.infer<typeof UserRefSchema>;

export const CreateHubProposalSchema = z
  .object({ gameId: id, name: HubNameSchema, blurb: BlurbSchema })
  .strict();
export type CreateHubProposalDto = z.infer<typeof CreateHubProposalSchema>;

export const HubProposalSchema = z
  .object({
    id,
    gameId: id,
    gameName: z.string(),
    gameIconUrl: z.string().nullable(),
    name: z.string(),
    blurb: z.string(),
    proposedBy: UserRefSchema,
    createdAt: isoDate,
  })
  .strict();
export type HubProposal = z.infer<typeof HubProposalSchema>;

export const HubProposalListSchema = z.object({ items: z.array(HubProposalSchema) }).strict();
export type HubProposalList = z.infer<typeof HubProposalListSchema>;

/** The admin may tidy the name/blurb while approving. */
export const ApproveHubProposalSchema = z
  .object({ name: HubNameSchema.optional(), blurb: BlurbSchema.optional() })
  .strict();
export type ApproveHubProposalDto = z.infer<typeof ApproveHubProposalSchema>;

export const RejectHubProposalSchema = z
  .object({ reason: z.string().trim().min(1).max(HUB_REJECT_REASON_MAX) })
  .strict();
export type RejectHubProposalDto = z.infer<typeof RejectHubProposalSchema>;

export const AdminCreateHubSchema = z
  .object({ gameId: id, name: HubNameSchema, blurb: BlurbSchema, leaderUserId: id })
  .strict();
export type AdminCreateHubDto = z.infer<typeof AdminCreateHubSchema>;

export const HubLeaderTransferSchema = z.object({ userId: id }).strict();
export type HubLeaderTransferDto = z.infer<typeof HubLeaderTransferSchema>;

export const HubStatusUpdateSchema = z.object({ status: z.enum(['active', 'archived']) }).strict();
export type HubStatusUpdateDto = z.infer<typeof HubStatusUpdateSchema>;

export const HubMemberRoleUpdateSchema = z.object({ role: z.enum(['officer', 'member']) }).strict();
export type HubMemberRoleUpdateDto = z.infer<typeof HubMemberRoleUpdateSchema>;

export const HubBanSchema = z
  .object({ reason: z.string().trim().max(HUB_BAN_REASON_MAX).optional() })
  .strict();
export type HubBanDto = z.infer<typeof HubBanSchema>;

export const HubBanListSchema = z
  .object({
    items: z.array(
      z
        .object({
          userId: id,
          username: z.string(),
          avatarUrl: z.string().nullable(),
          bannedAt: isoDate,
          bannedBy: z.string().nullable(),
          reason: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict();
export type HubBanList = z.infer<typeof HubBanListSchema>;

export const HubDirectoryQuerySchema = z
  .object({
    gameId: z.coerce.number().int().positive().optional(),
    q: z.string().trim().max(64).optional(),
    membership: z.enum(['all', 'joined', 'not-joined']).default('all'),
    sort: z.enum(['members', 'name', 'newest']).default('members'),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(24),
  })
  .strict();
export type HubDirectoryQuery = z.infer<typeof HubDirectoryQuerySchema>;

export const HubViewerStateSchema = z.enum(['member', 'leader', 'officer', 'not-member', 'banned']);
export type HubViewerState = z.infer<typeof HubViewerStateSchema>;

export const HubDirectoryEntrySchema = z
  .object({
    id,
    gameId: id,
    gameName: z.string(),
    gameIconUrl: z.string().nullable(),
    name: z.string(),
    blurb: z.string().nullable(),
    memberCount: z.number().int().nonnegative(),
    leaderName: z.string().nullable(),
    viewer: HubViewerStateSchema,
  })
  .strict();
export type HubDirectoryEntry = z.infer<typeof HubDirectoryEntrySchema>;

export const HubDirectoryPageSchema = z
  .object({
    items: z.array(HubDirectoryEntrySchema),
    nextCursor: z.string().nullable(),
    total: z.number().int().nonnegative(),
  })
  .strict();
export type HubDirectoryPage = z.infer<typeof HubDirectoryPageSchema>;

export const ProposeBlockedReasonSchema = z.enum(['not-in-discord', 'limit-reached', 'pending-for-game']);

/** `GET /hubs/by-game/:gameId` — the game page card. */
export const GameHubsSchema = z
  .object({
    hubs: z.array(HubDirectoryEntrySchema).max(50),
    myProposals: z.array(HubProposalSchema),
    canPropose: z.boolean(),
    proposeBlockedReason: ProposeBlockedReasonSchema.nullable(),
  })
  .strict();
export type GameHubs = z.infer<typeof GameHubsSchema>;

export const CommunityHubJoinResponseSchema = z
  .object({ joined: z.boolean(), memberCount: z.number().int().nonnegative() })
  .strict();
export type CommunityHubJoinResponse = z.infer<typeof CommunityHubJoinResponseSchema>;
