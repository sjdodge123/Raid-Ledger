import { z } from 'zod';
import { CompanionHubGuildIdSchema, CompanionTimestampSchema, CompanionWebpRefSchema } from './companion-common.schema.js';
import { companionEnvelopeShape } from './companion-envelope.schema.js';

// ============================================================
// `bg3-screenshot` v1 (ROK-1966) — `companion/bg3-screenshot/v1/`.
//
// One Baldur's Gate 3 screenshot the Companion found in Steam's per-game
// screenshot folder, re-encoded CLIENT-side to a WebP <= 1 MiB and uploaded
// through the existing blob store (`PUT /companion/v1/blobs/:sha256`). The
// user picks ONE BG3 hub in the Companion; `target.hubGuildId` names it and
// the server refuses a hub the uploader is not a live member of. Every
// object is `.strict()`.
// ============================================================

/** Registry id and version of this contract. */
export const BG3_SCREENSHOT_CONTRACT_ID = 'bg3-screenshot';
export const BG3_SCREENSHOT_CONTRACT_VERSION = 1;

/**
 * Decoded JSON body cap for one message, checked after the envelope parses.
 * The largest schema-valid message is well under 1 KB (no free text, no arrays).
 */
export const COMPANION_BG3_SCREENSHOT_MAX_BYTES = 4_096;

/** Largest edge of the ORIGINAL capture (8K is 7680; 16384 leaves room for ultrawide / multi-monitor). */
export const BG3_SCREENSHOT_SOURCE_EDGE_MAX = 16_384;

/** Which hub the screenshot is for (operator ruling Q3: the user picks ONE BG3 hub). */
export const Bg3ScreenshotTargetSchema = z.object({
    hubGuildId: CompanionHubGuildIdSchema,
}).strict();
export type Bg3ScreenshotTarget = z.infer<typeof Bg3ScreenshotTargetSchema>;

const SourceEdgeSchema = z.number().int().positive().max(BG3_SCREENSHOT_SOURCE_EDGE_MAX);

/** The screenshot (spec §3 "Contract"). */
export const Bg3ScreenshotPayloadSchema = z.object({
    /** When the screenshot was taken (collector: the source file's mtime). */
    takenAt: CompanionTimestampSchema,
    /** Original capture size in pixels, before the client re-encode. */
    width: SourceEdgeSchema,
    height: SourceEdgeSchema,
    /** The re-encoded WebP blob (<= 1 MiB, edges <= 4096); its sha256 is the server's dedupe key. */
    image: CompanionWebpRefSchema,
    target: Bg3ScreenshotTargetSchema,
}).strict().superRefine((p, ctx) => {
    if (p.image.width > p.width) {
        ctx.addIssue({ code: 'custom', path: ['image', 'width'], message: 'the WebP must not be wider than the original' });
    }
    if (p.image.height > p.height) {
        ctx.addIssue({ code: 'custom', path: ['image', 'height'], message: 'the WebP must not be taller than the original' });
    }
});
export type Bg3ScreenshotPayload = z.infer<typeof Bg3ScreenshotPayloadSchema>;

/** Full `bg3-screenshot` v1 message: the envelope with literals + the strict payload. */
export const Bg3ScreenshotMessageSchema = z.object({
    ...companionEnvelopeShape,
    contract: z.literal(BG3_SCREENSHOT_CONTRACT_ID),
    contractVersion: z.literal(BG3_SCREENSHOT_CONTRACT_VERSION),
    payload: Bg3ScreenshotPayloadSchema,
}).strict().superRefine((msg, ctx) => {
    if (Date.parse(msg.payload.takenAt) > Date.parse(msg.capturedAt)) {
        ctx.addIssue({ code: 'custom', path: ['payload', 'takenAt'], message: 'takenAt must not be after capturedAt' });
    }
});
export type Bg3ScreenshotMessage = z.infer<typeof Bg3ScreenshotMessageSchema>;
