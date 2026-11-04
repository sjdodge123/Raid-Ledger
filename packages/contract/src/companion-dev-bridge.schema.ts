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

/**
 * A probe request's LARGEST derived form, serialised, stays at or under this:
 * output form (defaults filled) plus a `probeId`, with `flavor` at its longest
 * (34 chars). POST, the Queue.lua entry and the probe-detail echo all measure
 * that same form (`devBridgeProbeRequestWorstBytes`), so a request the bridge
 * accepts always fits as a queue entry and as an echo.
 */
export const DEV_BRIDGE_PROBE_REQUEST_MAX_BYTES = 4_096;

/**
 * One probe-result item, serialised, stays at or under this: a call result
 * WITHOUT its `iterations`, and each single iteration. The addon cuts values
 * (and sets `truncated`) to meet it, so any one item fits a probe-detail page.
 */
export const DEV_BRIDGE_RESULT_ITEM_MAX_BYTES = 3_072;

/** UTF-8 byte length of `JSON.stringify(value)` — the unit every size cap here is measured in. */
export function devBridgeJsonBytes(value: unknown): number {
    let bytes = 0;
    for (const ch of JSON.stringify(value) ?? '') {
        const cp = ch.codePointAt(0) ?? 0;
        bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    }
    return bytes;
}

/** Adds a root-level `custom` issue when the value serialises to more than `max` bytes. */
export function devBridgeMaxBytes(max: number, what: string) {
    return (value: unknown, ctx: z.RefinementCtx): void => {
        const bytes = devBridgeJsonBytes(value);
        if (bytes > max) ctx.addIssue({ code: 'custom', path: [], message: `${what} is ${bytes} bytes; the cap is ${max}` });
    };
}

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
export const DevBridgeProbeCallSchema = ProbeCallBase.superRefine((call, ctx) => {
    if (checkCallShape(call, ctx)) checkCallAllowed(call, ctx);
});

/**
 * One call as echoed back in probe-detail: shape rules only, NOT the allowlist,
 * so a stored probe stays readable after the deny list grows.
 */
export const DevBridgeEchoedProbeCallSchema = ProbeCallBase.superRefine((call, ctx) => {
    checkCallShape(call, ctx);
});

/** Exactly one of fn/presence; presence takes no args; `$i` needs forEach. False when fn/presence is malformed. */
function checkCallShape(call: ProbeCallShape, ctx: z.RefinementCtx): boolean {
    if ((call.fn === undefined) === (call.presence === undefined)) {
        ctx.addIssue({ code: 'custom', path: [], message: 'Exactly one of fn or presence is required' });
        return false;
    }
    if (call.presence !== undefined && (call.args !== undefined || call.forEach !== undefined)) {
        ctx.addIssue({ code: 'custom', path: ['presence'], message: 'presence takes no args or forEach' });
    }
    const usesLoop = (call.args ?? []).some((a) => a === DEV_BRIDGE_LOOP_TOKEN);
    if (usesLoop && call.forEach === undefined) {
        ctx.addIssue({ code: 'custom', path: ['args'], message: '"$i" is only valid with forEach' });
    }
    return true;
}

/** `fn` must pass the allowlist (deny wins). */
function checkCallAllowed(call: ProbeCallShape, ctx: z.RefinementCtx): void {
    if (call.fn === undefined) return;
    const verdict = checkDevBridgeProbeFunction(call.fn);
    if (!verdict.allowed) {
        ctx.addIssue({ code: 'custom', path: ['fn'], message: `Function not allowed (${verdict.reason})` });
    }
}

/** Probe lifetime in hours. */
export const DevBridgeTtlHoursSchema = z.number().int().min(1).max(168);

/** The request fields, over a given call schema (allowlisted on POST/queue, shape-only when echoed). */
export function devBridgeProbeRequestFields<C extends z.ZodType<ProbeCallShape>>(call: C) {
    return {
        title: companionDisplayTextSchema(120),
        flavor: DevBridgeFlavorChoiceSchema.default('auto'),
        after: DevBridgeProbeAfterSchema.default('PLAYER_LOGIN'),
        ttlHours: DevBridgeTtlHoursSchema.default(72),
        calls: z.array(call).min(1).max(40),
    };
}

/** The longest flavor folder `DevBridgeFlavorSchema` accepts (34 chars) and a probe id (always 26 chars). */
const WORST_FLAVOR = `_${'a'.repeat(32)}_`;
const WORST_PROBE_ID = '0'.repeat(26);

/** Bytes of the request's largest derived form: `probeId` set, `flavor` at its longest. */
export function devBridgeProbeRequestWorstBytes(req: object): number {
    return devBridgeJsonBytes({ ...req, probeId: WORST_PROBE_ID, flavor: WORST_FLAVOR });
}

/** Unique call ids, backward countFrom, and largest derived form ≤ DEV_BRIDGE_PROBE_REQUEST_MAX_BYTES. */
export function checkDevBridgeProbeRequest(req: { calls: readonly ProbeCallShape[] }, ctx: z.RefinementCtx): void {
    checkCallIds(req.calls, ctx);
    const bytes = devBridgeProbeRequestWorstBytes(req);
    if (bytes <= DEV_BRIDGE_PROBE_REQUEST_MAX_BYTES) return;
    ctx.addIssue({
        code: 'custom',
        path: [],
        message: `Probe request is ${bytes} bytes as a queue entry with the longest flavor; the cap is ${DEV_BRIDGE_PROBE_REQUEST_MAX_BYTES}`,
    });
}

/** POST /dev/v1/probes body (strict). Defaults: flavor `auto`, after `PLAYER_LOGIN`, ttlHours 72. */
export const DevBridgeProbeRequestSchema = z
    .object(devBridgeProbeRequestFields(DevBridgeProbeCallSchema))
    .strict()
    .superRefine(checkDevBridgeProbeRequest);

/**
 * The request as probe-detail echoes it: the probe as QUEUED — output form,
 * `flavor` resolved to the folder it was written to (never `auto`), no
 * `probeId` (the page carries it). Shape rules only, no allowlist.
 */
export const DevBridgeEchoedProbeRequestSchema = z
    .object({
        ...devBridgeProbeRequestFields(DevBridgeEchoedProbeCallSchema),
        flavor: DevBridgeFlavorSchema,
        after: DevBridgeProbeAfterSchema,
        ttlHours: DevBridgeTtlHoursSchema,
    })
    .strict()
    .superRefine(checkDevBridgeProbeRequest);

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
export type DevBridgeEchoedProbeRequest = z.output<typeof DevBridgeEchoedProbeRequestSchema>;
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
    .strict()
    .superRefine(checkResultSizes);

type CallResultShape = z.output<typeof DevBridgeProbeCallResultSchema>;

/** Each item ≤ DEV_BRIDGE_RESULT_ITEM_MAX_BYTES; the whole result ≤ DEV_BRIDGE_PROBE_RESULT_MAX_BYTES. */
function checkResultSizes(result: { calls: readonly CallResultShape[] }, ctx: z.RefinementCtx): void {
    const tooBig = (value: unknown, path: (string | number)[]): void => {
        const bytes = devBridgeJsonBytes(value);
        if (bytes <= DEV_BRIDGE_RESULT_ITEM_MAX_BYTES) return;
        ctx.addIssue({ code: 'custom', path, message: `Result item is ${bytes} bytes; the cap is ${DEV_BRIDGE_RESULT_ITEM_MAX_BYTES}` });
    };
    result.calls.forEach((call, c) => {
        const { iterations, ...head } = call;
        tooBig(head, ['calls', c]);
        (iterations ?? []).forEach((it, i) => tooBig(it, ['calls', c, 'iterations', i]));
    });
    devBridgeMaxBytes(DEV_BRIDGE_PROBE_RESULT_MAX_BYTES, 'Probe result')(result, ctx);
}

export type DevBridgeProbeValue = z.output<typeof DevBridgeProbeValueSchema>;
export type DevBridgeProbeCallResult = z.output<typeof DevBridgeProbeCallResultSchema>;
export type DevBridgeProbeResult = z.output<typeof DevBridgeProbeResultSchema>;
