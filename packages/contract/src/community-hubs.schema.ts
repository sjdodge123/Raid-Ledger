import { z } from 'zod';
import { GuildKindSchema, HubStatusSchema } from './guilds.schema.js';

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
/**
 * ROK-1950 review (spoofing): invisible format characters (`\p{Cf}` — zero-width
 * U+200B–200D, U+2060, U+FEFF, bidi controls U+202A–202E / U+2066–2069, soft
 * hyphen) plus the blank fillers Unicode files as letters or symbols (Hangul
 * U+115F, U+1160, U+3164, U+FFA0; braille blank U+2800). ROK-2016 review: also
 * every `\p{Default_Ignorable_Code_Point}` (U+034F CGJ, VS1–VS16 U+FE00–FE0F,
 * …); those marks pass `\p{M}` otherwise. VS16 is let through only by
 * {@link EMOJI_VS16} below.
 */
const INVISIBLE_CHARS =
  /[\p{Cf}\u115f\u1160\u3164\uffa0\u2800]|\p{Default_Ignorable_Code_Point}/u;

/**
 * ROK-2016 review (spoof): a VS16 U+FE0F that emoji need — right after an
 * emoji base, or after a keycap base (`#`, `*`, a digit) that U+20E3 follows.
 * Removed only for the invisible test (never from the stored value); any other
 * VS16 (after a letter, leading, doubled) stays and is refused.
 */
const EMOJI_VS16 = /(?<=\p{Extended_Pictographic})\uFE0F|(?<=[#*0-9])\uFE0F(?=\u20E3)/gu;

/**
 * A visible letter or mark: an ignorable mark (CGJ, a variation selector, a
 * Hangul filler) is not a letter a joiner may sit next to. The lookahead runs
 * before the class in both directions, so it also holds inside a lookbehind.
 */
const VISIBLE_LETTER = String.raw`(?!\p{Default_Ignorable_Code_Point})[\p{L}\p{M}]`;
/** An emoji, optionally carrying VS16 or a skin-tone modifier (U+1F3FB–1F3FF). */
const EMOJI_LEFT = String.raw`\p{Extended_Pictographic}(?:\uFE0F|[\u{1F3FB}-\u{1F3FF}])?`;

/**
 * ROK-2016 (operator ruling 2026-10-26): a U+200C ZWNJ / U+200D ZWJ that sits
 * BETWEEN two visible letters, marks or emoji (Persian/Indic script, 👨‍👩‍👧,
 * 👩🏽‍💻, 🏳️‍🌈) is real text, not a spoof. Leading, trailing, doubled, space-,
 * digit- or ignorable-adjacent joiners do not match.
 */
const JOINER_BETWEEN_LETTERS = new RegExp(
  String.raw`(?<=${VISIBLE_LETTER}|${EMOJI_LEFT})[\u200C\u200D]` +
    String.raw`(?=${VISIBLE_LETTER}|\p{Extended_Pictographic})`,
  'gu',
);

/**
 * True when the name holds an invisible character other than an allowed
 * in-word joiner.
 */
function hasInvisibleChars(name: string): boolean {
  const stripped = name.replace(JOINER_BETWEEN_LETTERS, '').replace(EMOJI_VS16, '');
  return INVISIBLE_CHARS.test(stripped);
}

/**
 * The INPUT rule for a hub name (create, approve, admin create, rename):
 * trimmed, NFC-normalised (so the length and clash checks see one form),
 * 3–64 chars, no control or invisible characters (ZWJ/ZWNJ only between
 * letters or emoji — ROK-2016), at least one letter or digit.
 * Read/response schemas keep `z.string()` so stored names still parse.
 */
export const HubNameSchema = z
  .string()
  .trim()
  .normalize('NFC')
  .min(HUB_NAME_MIN)
  .max(HUB_NAME_MAX)
  .refine((v) => !CONTROL_CHARS.test(v), { message: 'Hub name cannot contain control characters' })
  .refine((v) => !hasInvisibleChars(v), { message: 'Hub name cannot contain invisible characters' })
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
    /** ROK-1892 — the hub's status after the call: a staff proposal is `active` at once; absent ⇒ `proposed` (older payloads). */
    status: HubStatusSchema.optional(),
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

/** `PATCH /hubs/:id` — leader/officer edits the blurb (renames go through `PATCH /guilds/:id/name`, ROK-1950). */
export const HubBlurbUpdateSchema = z.object({ blurb: BlurbSchema.nullable() }).strict();
export type HubBlurbUpdateDto = z.infer<typeof HubBlurbUpdateSchema>;

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
    /** ROK-1875: one hub kind only; absent = every kind live on this instance. */
    kind: GuildKindSchema.optional(),
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
    /** ROK-1875: the hub's kind — the directory lists community, game-server and WoW guild hubs. */
    kind: GuildKindSchema,
    /**
     * ROK-1883: staff only — true when an admin hid the hub. Staff see hidden
     * hubs (marked "Hidden"); everyone else never receives them, nor this key.
     */
    hidden: z.boolean().optional(),
  })
  .strict();
export type HubDirectoryEntry = z.infer<typeof HubDirectoryEntrySchema>;

export const HubDirectoryPageSchema = z
  .object({
    items: z.array(HubDirectoryEntrySchema),
    nextCursor: z.string().nullable(),
    total: z.number().int().nonnegative(),
    /** ROK-1875: kinds live on this instance (plugin-active), in `GUILD_KINDS` order; ignores the `kind` filter. */
    kinds: z.array(GuildKindSchema),
  })
  .strict();
export type HubDirectoryPage = z.infer<typeof HubDirectoryPageSchema>;

export const ProposeBlockedReasonSchema = z.enum(['not-in-discord', 'limit-reached', 'pending-for-game']);

/** `GET /hubs/by-game/:gameId` — the game page card. */
export const GameHubsSchema = z
  .object({
    hubs: z.array(HubDirectoryEntrySchema).max(50),
    /** Every hub of this game visible to the viewer, past the 50-row `hubs` cap (ROK-1883). */
    total: z.number().int().nonnegative(),
    myProposals: z.array(HubProposalSchema),
    canPropose: z.boolean(),
    proposeBlockedReason: ProposeBlockedReasonSchema.nullable(),
  })
  .strict();
export type GameHubs = z.infer<typeof GameHubsSchema>;

/** `GET /admin/hubs?status=` — one row of the admin list; `leader: null` = leaderless (OQ-7). */
export const AdminHubEntrySchema = z
  .object({
    id,
    gameId: id,
    gameName: z.string(),
    name: z.string(),
    blurb: z.string().nullable(),
    status: z.enum(['active', 'archived']),
    memberCount: z.number().int().nonnegative(),
    leader: z.object({ userId: id, username: z.string() }).strict().nullable(),
    createdAt: isoDate,
  })
  .strict();
export type AdminHubEntry = z.infer<typeof AdminHubEntrySchema>;

export const AdminHubListSchema = z.object({ items: z.array(AdminHubEntrySchema) }).strict();
export type AdminHubList = z.infer<typeof AdminHubListSchema>;

export const CommunityHubJoinResponseSchema = z
  .object({ joined: z.boolean(), memberCount: z.number().int().nonnegative() })
  .strict();
export type CommunityHubJoinResponse = z.infer<typeof CommunityHubJoinResponseSchema>;
