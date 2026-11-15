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
// Companion dev bridge v1 — the DevQueue.lua payload (ROK-2055 §5.2,
// consumer folded into LedgerLink by ROK-2190). rl-companion writes
// `<flavor>/Interface/AddOns/LedgerLink/DevQueue.lua` as
// `RaidLedgerProbeQueue = [==[<JSON>]==]`; this is that JSON. LedgerLink
// parses it with a JSON reader, never as Lua code, and only while `/rl dev on`.
// ============================================================

/**
 * Where rl-companion writes the queue, relative to `<wowDir>/<flavor>/`.
 * LedgerLink lists it in its TOC as an empty stub; the companion overwrites it.
 */
export const DEV_BRIDGE_PROBE_QUEUE_FILE = 'Interface/AddOns/LedgerLink/DevQueue.lua';

/** The single global DevQueue.lua assigns (a long-bracket JSON string). */
export const DEV_BRIDGE_PROBE_QUEUE_GLOBAL = 'RaidLedgerProbeQueue';

/** Most probe results LedgerLink keeps in `LedgerLinkDB.dev.probes` (oldest / expired pruned first). */
export const DEV_BRIDGE_PROBE_RESULTS_MAX = 50;

/** Version of the queue JSON shape inside DevQueue.lua. */
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

/** The JSON inside DevQueue.lua: every pending probe for that flavor, oldest first. */
export const DevBridgeProbeQueueFileSchema = z
    .object({
        queueVersion: z.literal(DEV_BRIDGE_PROBE_QUEUE_VERSION),
        probes: z.array(DevBridgeProbeQueueEntrySchema).max(50),
    })
    .strict();

export type DevBridgeProbeQueueEntry = z.output<typeof DevBridgeProbeQueueEntrySchema>;
export type DevBridgeProbeQueueFile = z.output<typeof DevBridgeProbeQueueFileSchema>;
