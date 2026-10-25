import type { z } from 'zod';
import { COMPANION_BG3_SAVE_MAX_BYTES } from './companion-common.schema.js';
import { BG3_SAVE_CONTRACT_ID, BG3_SAVE_CONTRACT_VERSION, Bg3SaveMessageSchema } from './companion-bg3-save.schema.js';

// ============================================================
// Companion contract registry (ROK-1954, spec D3) — the DATA half both
// sides share. Ingest parses the strict envelope first, then resolves
// `contract`/`contractVersion` here to the full message schema. The
// handler half (`{zodSchema, maxBytes, handler}`) is api-side (C3).
// Lookups walk OWN keys only, so `__proto__`/`constructor` never resolve.
// ============================================================

/** Blob slot names a contract may reference (each is a separately uploaded blob). */
export type CompanionBlobSlot = 'thumbnail';

/** Lifecycle of one contract version: `retired` versions are refused with the current one named. */
export type CompanionContractStatus = 'current' | 'accepted' | 'retired';

/** Everything ingest needs to accept one contract version. */
export interface CompanionContractVersionSpec {
    /** Full-message schema (envelope shape with literals + strict payload). */
    readonly schema: z.ZodType;
    /** Decoded JSON body cap, enforced by the reader before Zod. */
    readonly maxBytes: number;
    readonly blobSlots: readonly CompanionBlobSlot[];
    readonly status: CompanionContractStatus;
}

/** `contract id → version → spec`. */
export type CompanionContractTable = Readonly<Record<string, Readonly<Record<number, CompanionContractVersionSpec>>>>;

/** The shipped registry: `bg3-save` v1 only. */
export const COMPANION_CONTRACTS: CompanionContractTable = Object.freeze({
    [BG3_SAVE_CONTRACT_ID]: Object.freeze({
        [BG3_SAVE_CONTRACT_VERSION]: Object.freeze({
            schema: Bg3SaveMessageSchema,
            maxBytes: COMPANION_BG3_SAVE_MAX_BYTES,
            blobSlots: ['thumbnail'],
            status: 'current',
        }),
    }),
});

/** Result of `lookupCompanionContract`; C3 maps each non-`ok` kind to an ingest error code. */
export type CompanionContractLookup =
    | { readonly kind: 'ok'; readonly spec: CompanionContractVersionSpec }
    | { readonly kind: 'unknown_contract' }
    | { readonly kind: 'unknown_contract_version'; readonly current: number }
    | { readonly kind: 'retired'; readonly current: number };

/** Own-key read: `Object.entries` lists only own enumerable keys, so prototype keys never match. */
function ownEntry<T>(table: Readonly<Record<string | number, T>>, key: string): T | undefined {
    return Object.entries(table).find(([k]) => k === key)?.[1];
}

/** Highest `current` version, else the highest version of any status. */
function currentVersion(versions: Readonly<Record<number, CompanionContractVersionSpec>>): number {
    const entries = Object.entries(versions).map(([k, spec]) => ({ version: Number(k), spec }));
    const current = entries.filter((e) => e.spec.status === 'current');
    const pool = current.length > 0 ? current : entries;
    return pool.reduce((max, e) => Math.max(max, e.version), 0);
}

/**
 * Resolve a contract id + version to its spec. Unknown id → `unknown_contract`
 * (404); unknown version → `unknown_contract_version`; a retired version →
 * `retired`. `table` is injectable for tests; it defaults to the shipped one.
 */
export function lookupCompanionContract(
    id: string,
    version: number,
    table: CompanionContractTable = COMPANION_CONTRACTS,
): CompanionContractLookup {
    const versions = ownEntry(table, id);
    if (versions === undefined) return { kind: 'unknown_contract' };
    const spec = ownEntry(versions, String(version));
    if (spec === undefined) return { kind: 'unknown_contract_version', current: currentVersion(versions) };
    if (spec.status === 'retired') return { kind: 'retired', current: currentVersion(versions) };
    return { kind: 'ok', spec };
}
