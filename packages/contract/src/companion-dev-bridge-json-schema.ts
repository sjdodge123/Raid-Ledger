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
    DEV_BRIDGE_SV_READABLE_ADDONS,
} from './companion-dev-bridge-endpoints.schema.js';
import { DevBridgeProbeQueueFileSchema } from './companion-dev-bridge-queue.schema.js';
import {
    DevBridgeSnapshotHistorySchema,
    DevBridgeSnapshotPageSchema,
    LedgerLinkSnapshotSchema,
} from './companion-dev-bridge-snapshot.schema.js';
import { DevBridgeBg3SaveStructureSchema, DevBridgeBg3SavesSchema } from './companion-dev-bridge-bg3.schema.js';
import { DevBridgeBg3InstallSchema, DevBridgeBg3SaveCatalogueSchema } from './companion-dev-bridge-bg3-catalogue.schema.js';
import { DevBridgeEventsSchema } from './companion-dev-bridge-events.schema.js';

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
 * RECEIVES (`probe-request` from agents, `probe-result` and
 * `ledgerlink-snapshot` from the addons) are
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
    events: DevBridgeEventsSchema,
    'ledgerlink-snapshot': LedgerLinkSnapshotSchema,
    'ledgerlink-snapshot-page': DevBridgeSnapshotPageSchema,
    'ledgerlink-snapshot-history': DevBridgeSnapshotHistorySchema,
    'bg3-saves': DevBridgeBg3SavesSchema,
    'bg3-save-structure': DevBridgeBg3SaveStructureSchema,
    'bg3-install': DevBridgeBg3InstallSchema,
    'bg3-save-catalogue': DevBridgeBg3SaveCatalogueSchema,
    error: DevBridgeErrorSchema,
} as const satisfies Record<string, z.ZodType>;

export type DevBridgeMessageName = keyof typeof DEV_BRIDGE_MESSAGES;

const INPUT_MESSAGES: ReadonlySet<string> = new Set(['probe-request', 'probe-result', 'ledgerlink-snapshot']);

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
            'GENERATED from packages/contract/src/companion-dev-bridge.schema.ts and companion-dev-bridge-endpoints.schema.ts / companion-dev-bridge-snapshot.schema.ts / companion-dev-bridge-bg3.schema.ts / companion-dev-bridge-bg3-catalogue{,-report}.schema.ts / companion-dev-bridge-events.schema.ts — do not edit by hand. One $defs entry per /dev/v1/* body plus the probe request/result. sv-raw is also the body of GET /dev/v1/addons/<folder>/sv, where folder is one of ' +
            DEV_BRIDGE_SV_READABLE_ADDONS.join(', ') +
            ' (any other folder: 404 not_found). Refinements enforced by the Zod schema but not expressible here: probe fn paths must pass allowlist.json (deny wins); exactly one of fn/presence per call; "$i" only with forEach; call ids unique; forEach.countFrom names an earlier fn call; ≤40 keys per result table; relative paths have no "..", drive or backslash; log lines hold no unredacted token (any letter case). Byte caps, measured as UTF-8 of the JSON serialisation: every response body ≤16 KiB, a probe request ≤4 KiB measured as its largest queue entry (output form + probeId, flavor padded to 34 chars), each probe-result item (a call without iterations, or one iteration) ≤3 KiB, a whole probe result ≤64 KiB. ledgerlink-snapshot: no string or table key holds a player GUID (Player-<digits>-<8 hex>); apis[].path unique; a call carries type (and no values) iff status is presence; each calls/apis/sections item ≤3 KiB, the head (snapshot minus those three arrays) ≤4 KiB, the whole snapshot ≤48 KiB (a ledgerlink-snapshot-page slice applies only the GUID and presence rules). bg3-saves / bg3-save-structure: no string or object key holds a GUID (32 hex split 8-4-4-4-12 by -, _, . or nothing, braced or not; a Larian h…g… handle, any case; ≥32 hex once every -, _, ., {, } is stripped) or a run of ≥10 decimal digits (saveRef exempt); saves[].saveRef, party[].slot and equipment[].slot within a party row unique; each bg3-save-structure party row ≤6 KiB. bg3-install / bg3-save-catalogue: the same GUID / digit guard; paks[].rel, party[].slot and items[].slot within a row unique; found:false ⇒ no paks; store null iff found is false; each matched entry part < its pak parts; resolvedName/resolvedRarity ≤ total; catalogueState absent/failed ⇒ every name and rarity null; each bg3-save-catalogue party row ≤12 KiB. collectors.bg3Catalogue: reason set iff state is absent/failed and from the list for that state; state ready ⇒ buildMs, builtAt, counts non-null; state absent ⇒ buildMs, builtAt, counts, lastLookup null; events: no free text — every field is an enum, number, timestamp or ^[a-z0-9_-]{1,32}$ token; a cursor is valid only on the route (and addons folder) that issued it; see CONTRACT.md.',
        $defs: buildDefs(),
        not: {},
    };
}

/** Exact file contents of `companion/dev-bridge/v1/schema.json` (2-space indent, trailing newline). */
export function serializeDevBridgeJsonSchema(): string {
    return `${JSON.stringify(buildDevBridgeJsonSchema(), null, 2)}\n`;
}
