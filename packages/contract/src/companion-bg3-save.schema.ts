import { z } from 'zod';
import { CompanionTimestampSchema, CompanionWebpRefSchema } from './companion-common.schema.js';
import { companionEnvelopeShape } from './companion-envelope.schema.js';

// ============================================================
// `bg3-save` v1 (ROK-1954) — `companion/bg3-save/v1/`.
//
// One Baldur's Gate 3 save, normalised from the package's `SaveInfo.json`
// by the Companion collector. Every object is `.strict()`: `Position` and
// `Subregion` are dropped by the normaliser, so a leaked key REJECTS the
// message. Engine ids stay open bounded strings (never enums) so an unseen
// level, class or patch is not a breaking change.
// ============================================================

/** Registry id and version of this contract. */
export const BG3_SAVE_CONTRACT_ID = 'bg3-save';
export const BG3_SAVE_CONTRACT_VERSION = 1;

/** Larian engine id, e.g. `Elf_WoodElf`, `SCL_Main_A`, `DifficultyHard`. */
export const BG3_ID_RE = /^[A-Za-z0-9_]{1,64}$/;
export const BG3_SAVE_NAME_MAX_CHARS = 128;
export const BG3_PARTY_MAX = 16;
/** Vanilla cap is 12 (UNVERIFIED); 20 leaves room for level-cap mods. */
export const BG3_LEVEL_MAX = 20;
export const BG3_XP_MAX = 10_000_000;
export const BG3_CLASSES_MAX = 12;

const Bg3IdSchema = z.string().regex(BG3_ID_RE);

/** One class entry; `sub` is `null` when the raw `Sub` is `""` or absent. */
export const Bg3ClassSchema = z.object({
    main: Bg3IdSchema,
    sub: Bg3IdSchema.nullable(),
}).strict();
export type Bg3Class = z.infer<typeof Bg3ClassSchema>;

/** One `"Active Party".Characters[]` entry, in save order. */
export const Bg3PartyMemberSchema = z.object({
    origin: Bg3IdSchema,
    race: Bg3IdSchema,
    level: z.number().int().min(1).max(BG3_LEVEL_MAX),
    xpLevel: z.number().int().min(0).max(BG3_XP_MAX),
    xpTotal: z.number().int().min(0).max(BG3_XP_MAX),
    classes: z.array(Bg3ClassSchema).max(BG3_CLASSES_MAX),
    isSummon: z.boolean(),
}).strict().superRefine((m, ctx) => {
    if (m.xpLevel > m.xpTotal) ctx.addIssue({ code: 'custom', message: 'xpLevel must not exceed xpTotal' });
    if (m.isSummon && m.classes.length > 0) ctx.addIssue({ code: 'custom', message: 'a summon has no classes' });
    if (!m.isSummon && m.classes.length === 0) ctx.addIssue({ code: 'custom', message: 'a non-summon needs at least one class' });
});
export type Bg3PartyMember = z.infer<typeof Bg3PartyMemberSchema>;

/** The normalised save (spec "Bg3SavePayloadSchema"). */
export const Bg3SavePayloadSchema = z.object({
    saveName: z.string().min(1).max(BG3_SAVE_NAME_MAX_CHARS),
    savedAt: CompanionTimestampSchema,
    /** Lowercase hex SHA-256 of the save-folder name (or GameID) — never the raw name. */
    campaignKey: z.string().regex(/^[0-9a-f]{16,64}$/),
    campaignKeySource: z.enum(['save-folder', 'game-id']),
    gameVersion: z.string().regex(/^\d{1,4}(\.\d{1,10}){1,3}$/),
    platform: z.string().regex(/^[A-Za-z0-9_]{1,32}$/),
    currentLevel: Bg3IdSchema,
    difficulty: Bg3IdSchema,
    ruleset: Bg3IdSchema.nullable(),
    party: z.array(Bg3PartyMemberSchema).min(1).max(BG3_PARTY_MAX),
    thumbnail: CompanionWebpRefSchema.nullable(),
}).strict();
export type Bg3SavePayload = z.infer<typeof Bg3SavePayloadSchema>;

/** Full `bg3-save` v1 message: the envelope with literals + the strict payload. */
export const Bg3SaveMessageSchema = z.object({
    ...companionEnvelopeShape,
    contract: z.literal(BG3_SAVE_CONTRACT_ID),
    contractVersion: z.literal(BG3_SAVE_CONTRACT_VERSION),
    payload: Bg3SavePayloadSchema,
}).strict().superRefine((msg, ctx) => {
    if (Date.parse(msg.payload.savedAt) > Date.parse(msg.capturedAt)) {
        ctx.addIssue({ code: 'custom', path: ['payload', 'savedAt'], message: 'savedAt must not be after capturedAt' });
    }
});
export type Bg3SaveMessage = z.infer<typeof Bg3SaveMessageSchema>;
