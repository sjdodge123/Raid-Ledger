import { z } from 'zod';
import { DEV_BRIDGE_CONTRACT_VERSION, DevBridgeProbeRequestSchema, DevBridgeProbeResultSchema } from './companion-dev-bridge.schema.js';
import {
    DevBridgeAddonsSchema,
    DevBridgeCollectorsSchema,
    DevBridgeErrorSchema,
    DevBridgeHealthSchema,
    DevBridgeLogsSchema,
    DevBridgeProbeCancelledSchema,
    DevBridgeProbeDetailSchema,
    DevBridgeProbeListSchema,
    DevBridgeProbeQueuedSchema,
    DevBridgeSvParsedSchema,
    DevBridgeSvRawSchema,
} from './companion-dev-bridge-endpoints.schema.js';
import { DevBridgeProbeQueueFileSchema } from './companion-dev-bridge-queue.schema.js';

// ============================================================
// Companion dev bridge v1 JSON Schema (ROK-2055).
// `packages/contract/companion/dev-bridge/v1/schema.json` is GENERATED here —
// run `npm run build -w packages/contract && node packages/contract/scripts/gen-companion-schemas.mjs`.
// The contract spec `src/__tests__/companion-dev-bridge-contract.spec.ts`
// fails when the committed file (or `allowlist.json`) differs.
// ============================================================

/** `$id` of the dev-bridge JSON Schema. */
export const DEV_BRIDGE_SCHEMA_ID =
    `https://raid.gamernight.net/contracts/companion/dev-bridge/v${DEV_BRIDGE_CONTRACT_VERSION}/schema.json`;

/**
 * Every body on the bridge, keyed by its `$defs` name — also the fixture
 * filename prefix (`<key>.json` or `<key>--<case>.json`). Bodies the companion
 * RECEIVES (`probe-request` from agents, `probe-result` from the addon) are
 * generated in input mode; everything the companion SENDS (including the
 * Queue.lua JSON, `probe-queue`) in output mode.
 */
export const DEV_BRIDGE_MESSAGES = {
    'probe-request': DevBridgeProbeRequestSchema,
    'probe-result': DevBridgeProbeResultSchema,
    'probe-queue': DevBridgeProbeQueueFileSchema,
    health: DevBridgeHealthSchema,
    addons: DevBridgeAddonsSchema,
    'sv-raw': DevBridgeSvRawSchema,
    'sv-parsed': DevBridgeSvParsedSchema,
    'probe-queued': DevBridgeProbeQueuedSchema,
    'probe-list': DevBridgeProbeListSchema,
    'probe-detail': DevBridgeProbeDetailSchema,
    'probe-cancelled': DevBridgeProbeCancelledSchema,
    logs: DevBridgeLogsSchema,
    collectors: DevBridgeCollectorsSchema,
    error: DevBridgeErrorSchema,
} as const satisfies Record<string, z.ZodType>;

export type DevBridgeMessageName = keyof typeof DEV_BRIDGE_MESSAGES;

const INPUT_MESSAGES: ReadonlySet<string> = new Set(['probe-request', 'probe-result']);

/** One message's draft-2020-12 schema, without its own `$schema` key. */
function toDef(schema: z.ZodType, io: 'input' | 'output'): Record<string, unknown> {
    const generated: Record<string, unknown> = z.toJSONSchema(schema, {
        target: 'draft-2020-12',
        io,
        unrepresentable: 'throw',
    });
    const { $schema: _drop, ...def } = generated;
    return def;
}

function buildDefs(): Record<string, Record<string, unknown>> {
    const defs: Record<string, Record<string, unknown>> = {};
    for (const [name, schema] of Object.entries(DEV_BRIDGE_MESSAGES)) {
        defs[name] = toDef(schema, INPUT_MESSAGES.has(name) ? 'input' : 'output');
    }
    return defs;
}

/** The JSON Schema object for `companion/dev-bridge/v1` — one `$defs` entry per body; the root accepts none. */
export function buildDevBridgeJsonSchema(): Record<string, unknown> {
    return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: DEV_BRIDGE_SCHEMA_ID,
        title: `RL Companion dev bridge v${DEV_BRIDGE_CONTRACT_VERSION}`,
        description:
            'GENERATED from packages/contract/src/companion-dev-bridge.schema.ts and companion-dev-bridge-endpoints.schema.ts — do not edit by hand. One $defs entry per /dev/v1/* body plus the probe request/result. Refinements enforced by the Zod schema but not expressible here: probe fn paths must pass allowlist.json (deny wins); exactly one of fn/presence per call; "$i" only with forEach; call ids unique; forEach.countFrom names an earlier fn call; ≤40 keys per result table; relative paths have no "..", drive or backslash; log lines hold no unredacted token (any letter case). Byte caps, measured as UTF-8 of the JSON serialisation: every response body ≤16 KiB, a probe request ≤4 KiB measured as its largest queue entry (output form + probeId, flavor padded to 34 chars), each probe-result item (a call without iterations, or one iteration) ≤3 KiB, a whole probe result ≤64 KiB; see CONTRACT.md.',
        $defs: buildDefs(),
        not: {},
    };
}

/** Exact file contents of `companion/dev-bridge/v1/schema.json` (2-space indent, trailing newline). */
export function serializeDevBridgeJsonSchema(): string {
    return `${JSON.stringify(buildDevBridgeJsonSchema(), null, 2)}\n`;
}
