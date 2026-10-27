import { z } from 'zod';

// ============================================================
// Larian's own BG3 `SaveInfo.json` (ROK-1954) — the INPUT to
// `normaliseBg3SaveInfo`, NEVER on the wire and absent from `schema.json`.
//
// `.loose()` at every level: Larian owns this file and adds keys on
// patches, so an unknown key must not break the parser. Only the keys the
// normaliser READS are validated. `Position` (a 3-number tuple) and
// `Subregion` (a string) are present in real files but deliberately NOT
// declared — the normaliser drops them, so a Larian change to their shape
// must not fail the parse. Stripping a UTF-8 BOM and `JSON.parse` are the
// caller's job; this schema takes the parsed object.
// ============================================================

/** Most `Difficulty` tuple entries accepted (`[difficulty, ruleset, ...]`). */
export const BG3_RAW_DIFFICULTY_MAX = 4;

/** One raw `Classes[]` entry; `Sub` is `""` or absent before a subclass is chosen. */
export const Bg3RawClassSchema = z.object({
    Main: z.string(),
    Sub: z.string().optional(),
}).loose();
export type Bg3RawClass = z.infer<typeof Bg3RawClassSchema>;

/** One raw `"Active Party".Characters[]` entry. A summon has no `Classes` key. */
export const Bg3RawCharacterSchema = z.object({
    Classes: z.array(Bg3RawClassSchema).optional(),
    'Experience Points (Current level)': z.number().int(),
    'Experience Points (Total)': z.number().int(),
    Level: z.number().int(),
    Origin: z.string(),
    Race: z.string(),
}).loose();
export type Bg3RawCharacter = z.infer<typeof Bg3RawCharacterSchema>;

/** The raw `SaveInfo.json` root. `Difficulty` is `[difficulty, ruleset?, ...]`, 1–4 entries. */
export const Bg3SaveInfoRawSchema = z.object({
    'Active Party': z.object({ Characters: z.array(Bg3RawCharacterSchema) }).loose(),
    'Current Level': z.string(),
    Difficulty: z.tuple([z.string()], z.string()).refine(
        (t) => t.length <= BG3_RAW_DIFFICULTY_MAX,
        { message: `Difficulty has at most ${BG3_RAW_DIFFICULTY_MAX} entries` },
    ),
    'Game Version': z.string(),
    Platform: z.string(),
    'Save Name': z.string(),
}).loose();
export type Bg3SaveInfoRaw = z.infer<typeof Bg3SaveInfoRawSchema>;
