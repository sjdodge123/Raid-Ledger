import { z } from 'zod';
import { checkDevBridgeProbeFunction } from './companion-dev-bridge-allowlist.js';
import { companionDisplayTextSchema, CompanionTimestampSchema, CompanionVersionStringSchema } from './companion-common.schema.js';

// ============================================================
// Companion dev bridge v1 (ROK-2055) — the LAN-only developer side channel
// on rl-companion that skeleton-key reads (`/dev/v1/*`). Raid Ledger owns the
// wire format (`packages/contract/companion/dev-bridge/v1/`); rl-companion and
// the dev-only LedgerLinkProbe addon pin it. NOT a companion-envelope message:
// it is not in `COMPANION_CONTRACTS` and the Raid Ledger server never reads it.
// This file: shared primitives + ProbeRequest (§5.1) + ProbeResult.
// Endpoint bodies (§6): `companion-dev-bridge-endpoints.schema.ts`.
// ============================================================

/** Version of the `companion/dev-bridge` contract folder (`bridgeVersion` in /health). */
export const DEV_BRIDGE_CONTRACT_VERSION = 1;

/** Every `/dev/v1/*` response body, serialised, stays at or under this (skeleton-key cuts at 20,000 chars). */
export const DEV_BRIDGE_PAGE_MAX_BYTES = 16_384;

/** A whole ProbeResult as the addon stores it, serialised, stays at or under this. */
export const DEV_BRIDGE_PROBE_RESULT_MAX_BYTES = 65_536;

/** Default port of the dev bridge listener (changeable in the companion window). */
export const DEV_BRIDGE_DEFAULT_PORT = 47_655;

/** The loop-index token a `forEach` call may pass as an argument. */
export const DEV_BRIDGE_LOOP_TOKEN = '$i';

/** Probe id: a ULID (Crockford base32, 26 chars). */
export const DevBridgeProbeIdSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);

/** Opaque page cursor; `next: null` means the last page. */
export const DevBridgeCursorSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

/** `next` on every paged body. */
export const DevBridgeNextSchema = DevBridgeCursorSchema.nullable();

/** A WoW flavor folder name (`_classic_era_`, `_anniversary_`, …), matched against discovered folders. */
export const DevBridgeFlavorSchema = z.string().regex(/^_[a-z0-9_]{1,32}_$/);

/** Where the companion sends the probe: `auto` = the flavor LedgerLink SavedVariables was last seen in. */
export const DevBridgeFlavorChoiceSchema = z.union([z.literal('auto'), DevBridgeFlavorSchema]);

/** Probe call id, unique within one request. */
export const DevBridgeCallIdSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/);

/** Events after which the addon runs the calls (closed enum). */
export const DevBridgeProbeAfterSchema = z.enum(['PLAYER_LOGIN', 'PLAYER_ENTERING_WORLD', 'GUILD_ROSTER_UPDATE']);

/** One literal argument: string ≤128, finite number, boolean, null, or the loop token `$i`. */
export const DevBridgeProbeArgSchema = z.union([z.string().max(128), z.number(), z.boolean(), z.null()]);

/** `forEach`: loop `$i` from 1 to min(first return of `countFrom`, `max`). */
export const DevBridgeProbeForEachSchema = z
    .object({ countFrom: DevBridgeCallIdSchema, max: z.number().int().min(1).max(200) })
    .strict();

/** 1-3 dot-separated identifiers (the allowlist's `segmentPattern` × `maxSegments`). */
const PathSchema = z
    .string()
    .max(160)
    .regex(/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*){0,2}$/);

/** One call: either `fn` (+ optional `args`/`forEach`) or `presence` (a typeof check, nothing is called). */
const ProbeCallBase = z
    .object({
        id: DevBridgeCallIdSchema,
        fn: PathSchema.optional(),
        presence: PathSchema.optional(),
        args: z.array(DevBridgeProbeArgSchema).max(8).optional(),
        forEach: DevBridgeProbeForEachSchema.optional(),
    })
    .strict();

type ProbeCallShape = z.output<typeof ProbeCallBase>;

/** One call, with the shape + allowlist refinements (issue path `fn` when the allowlist refuses it). */
export const DevBridgeProbeCallSchema = ProbeCallBase.superRefine(checkCallShape);

/** Exactly one of fn/presence; presence takes no args; `$i` needs forEach; fn must pass the allowlist. */
function checkCallShape(call: ProbeCallShape, ctx: z.RefinementCtx): void {
    if ((call.fn === undefined) === (call.presence === undefined)) {
        ctx.addIssue({ code: 'custom', path: [], message: 'Exactly one of fn or presence is required' });
        return;
    }
    if (call.presence !== undefined && (call.args !== undefined || call.forEach !== undefined)) {
        ctx.addIssue({ code: 'custom', path: ['presence'], message: 'presence takes no args or forEach' });
    }
    const usesLoop = (call.args ?? []).some((a) => a === DEV_BRIDGE_LOOP_TOKEN);
    if (usesLoop && call.forEach === undefined) {
        ctx.addIssue({ code: 'custom', path: ['args'], message: '"$i" is only valid with forEach' });
    }
    if (call.fn === undefined) return;
    const verdict = checkDevBridgeProbeFunction(call.fn);
    if (!verdict.allowed) {
        ctx.addIssue({ code: 'custom', path: ['fn'], message: `Function not allowed (${verdict.reason})` });
    }
}

/** POST /dev/v1/probes body (strict). Defaults: flavor `auto`, after `PLAYER_LOGIN`, ttlHours 72. */
export const DevBridgeProbeRequestSchema = z
    .object({
        title: companionDisplayTextSchema(120),
        flavor: DevBridgeFlavorChoiceSchema.default('auto'),
        after: DevBridgeProbeAfterSchema.default('PLAYER_LOGIN'),
        ttlHours: z.number().int().min(1).max(168).default(72),
        calls: z.array(DevBridgeProbeCallSchema).min(1).max(40),
    })
    .strict()
    .superRefine((req, ctx) => checkCallIds(req.calls, ctx));

/** Call ids are unique; `forEach.countFrom` names an EARLIER `fn` call. */
function checkCallIds(calls: readonly ProbeCallShape[], ctx: z.RefinementCtx): void {
    const seen = new Map<string, ProbeCallShape>();
    calls.forEach((call, index) => {
        if (seen.has(call.id)) {
            ctx.addIssue({ code: 'custom', path: ['calls', index, 'id'], message: 'Duplicate call id' });
        }
        const from = call.forEach?.countFrom;
        if (from !== undefined && seen.get(from)?.fn === undefined) {
            ctx.addIssue({
                code: 'custom',
                path: ['calls', index, 'forEach', 'countFrom'],
                message: 'countFrom must name an earlier fn call',
            });
        }
        seen.set(call.id, call);
    });
}

export type DevBridgeProbeRequest = z.output<typeof DevBridgeProbeRequestSchema>;
export type DevBridgeProbeRequestInput = z.input<typeof DevBridgeProbeRequestSchema>;

// ------------------------------------------------------------
// ProbeResult — what LedgerLinkProbe stores in LedgerLinkProbeDB.results[id]
// (a JSON string) and the companion serves at /dev/v1/probes/:id.
// Values nest Lua tables at most 3 deep; ≤40 entries per table; strings ≤512.
// ------------------------------------------------------------

const ValueString = z.string().max(512);
const Leaf = z.union([ValueString, z.number(), z.boolean(), z.null()]);
const tableOf = <T extends z.ZodType>(item: T) =>
    z.union([z.array(item).max(40), z.record(z.string().max(128), item).refine((r) => Object.keys(r).length <= 40)]);
const Table3 = tableOf(Leaf);
const Table2 = tableOf(z.union([Leaf, Table3]));
const Table1 = tableOf(z.union([Leaf, Table2]));

/** One Lua return value: a leaf, or a table nested at most 3 deep. */
export const DevBridgeProbeValueSchema = z.union([Leaf, Table1]);

/** Outcome of one call (or one forEach iteration). */
export const DevBridgeCallStatusSchema = z.enum(['ok', 'missing', 'error', 'denied']);

const outcomeShape = {
    status: DevBridgeCallStatusSchema,
    values: z.array(DevBridgeProbeValueSchema).max(40).optional(),
    error: z.string().max(512).optional(),
};

/** One forEach iteration (`i` = the loop index passed as `$i`). */
export const DevBridgeProbeIterationSchema = z
    .object({ i: z.number().int().min(1).max(200), ...outcomeShape })
    .strict();

/** One call's result. `presence` calls report `values: [<lua type name>]`. */
export const DevBridgeProbeCallResultSchema = z
    .object({
        id: DevBridgeCallIdSchema,
        ...outcomeShape,
        iterations: z.array(DevBridgeProbeIterationSchema).max(200).optional(),
        truncated: z.literal(true).optional(),
    })
    .strict();

/** The whole result for one probe. `truncated` is true when any cap cut something. */
export const DevBridgeProbeResultSchema = z
    .object({
        probeId: DevBridgeProbeIdSchema,
        capturedAt: CompanionTimestampSchema,
        addonVersion: CompanionVersionStringSchema,
        calls: z.array(DevBridgeProbeCallResultSchema).max(40),
        truncated: z.boolean(),
    })
    .strict();

export type DevBridgeProbeValue = z.output<typeof DevBridgeProbeValueSchema>;
export type DevBridgeProbeCallResult = z.output<typeof DevBridgeProbeCallResultSchema>;
export type DevBridgeProbeResult = z.output<typeof DevBridgeProbeResultSchema>;
