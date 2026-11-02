import { z } from 'zod';
import {
    checkDevBridgeProbeRequest,
    DevBridgeFlavorSchema,
    DevBridgeProbeAfterSchema,
    DevBridgeProbeCallSchema,
    DevBridgeProbeIdSchema,
    devBridgeProbeRequestFields,
    DevBridgeTtlHoursSchema,
} from './companion-dev-bridge.schema.js';

// ============================================================
// Companion dev bridge v1 — the Queue.lua payload (ROK-2055 §5.2).
// rl-companion writes `<flavor>/Interface/AddOns/LedgerLinkProbe/Queue.lua` as
// `RaidLedgerProbeQueue = [==[<JSON>]==]`; this is that JSON. The addon parses
// it with a JSON reader, never as Lua code.
// ============================================================

/** Version of the queue JSON shape inside Queue.lua. */
export const DEV_BRIDGE_PROBE_QUEUE_VERSION = 1;

/**
 * One pending probe: the POST body in OUTPUT form (every default filled),
 * `flavor` resolved to the folder the file sits in (never `auto`), plus the
 * companion-assigned `probeId`. The allowlist still applies.
 */
export const DevBridgeProbeQueueEntrySchema = z
    .object({
        probeId: DevBridgeProbeIdSchema,
        ...devBridgeProbeRequestFields(DevBridgeProbeCallSchema),
        flavor: DevBridgeFlavorSchema,
        after: DevBridgeProbeAfterSchema,
        ttlHours: DevBridgeTtlHoursSchema,
    })
    .strict()
    .superRefine(checkDevBridgeProbeRequest);

/** The JSON inside Queue.lua: every pending probe for that flavor, oldest first. */
export const DevBridgeProbeQueueFileSchema = z
    .object({
        queueVersion: z.literal(DEV_BRIDGE_PROBE_QUEUE_VERSION),
        probes: z.array(DevBridgeProbeQueueEntrySchema).max(50),
    })
    .strict();

export type DevBridgeProbeQueueEntry = z.output<typeof DevBridgeProbeQueueEntrySchema>;
export type DevBridgeProbeQueueFile = z.output<typeof DevBridgeProbeQueueFileSchema>;
