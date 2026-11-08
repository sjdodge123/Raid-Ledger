/**
 * ROK-2116: tolerate API/bundle version skew at the response-schema boundary.
 *
 * Contract response schemas are `.strict()`. A tab still running the bundle
 * from before a deploy parses the NEW server's payload with its OLD schema,
 * so every additive field (a guild `crest`, a hub `avatar`) fails with
 * `unrecognized_keys` and the page errors. When unknown keys are the ONLY
 * problem, the payload is a superset of what this bundle understands: drop
 * those keys and accept the rest. Any other issue (wrong type, missing field)
 * is a real shape error and still throws — the schemas themselves stay strict.
 *
 * Unions: a `z.discriminatedUnion`, and a plain `z.union` where only ONE
 * branch fails solely on unknown keys, both surface plain `unrecognized_keys`
 * issues and recover. A plain `z.union` where two or more branches fail only
 * on extra/optional keys reports `invalid_union` instead; that is not
 * stripped and throws exactly as before (fails safe).
 */
import type { z } from 'zod';
import { toast } from 'sonner';
import { Sentry } from '../../sentry';

type ZodIssue = z.core.$ZodIssue;
type UnrecognizedKeysIssue = Extract<ZodIssue, { code: 'unrecognized_keys' }>;

/** Copy for the once-per-page-load "reload to update" notice. */
export const VERSION_SKEW_NOTICE = 'A new version of Raid Ledger is available.';
export const VERSION_SKEW_ACTION = 'Reload';
const VERSION_SKEW_TOAST_ID = 'app-version-skew';

const SKEW_MESSAGE = 'Response carried fields this bundle does not know';

let noticeShown = false;

/** Test-only: re-arm the once-per-page-load notice. */
export function resetVersionSkewNoticeForTests(): void {
    noticeShown = false;
}

function isUnrecognizedKeys(issue: ZodIssue): issue is UnrecognizedKeysIssue {
    return issue.code === 'unrecognized_keys';
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
    return typeof value === 'object' && value !== null;
}

/** Walk `path` from `root`; undefined when any hop is not an object/array. */
function resolvePath(root: unknown, path: readonly PropertyKey[]): unknown {
    let node: unknown = root;
    for (const segment of path) {
        if (!isRecord(node)) return undefined;
        node = node[segment];
    }
    return node;
}

/**
 * Returns a copy of `data` with every unrecognized key removed at its issue
 * path, or `null` when any issue is something other than `unrecognized_keys`
 * (or a path no longer resolves) — i.e. when the payload is not a pure
 * superset of the schema.
 */
export function stripUnrecognizedKeys(data: unknown, issues: readonly ZodIssue[]): unknown {
    if (issues.length === 0 || !issues.every(isUnrecognizedKeys)) return null;
    const copy: unknown = structuredClone(data);
    for (const issue of issues) {
        const target = resolvePath(copy, issue.path);
        if (!isRecord(target)) return null;
        for (const key of issue.keys) Reflect.deleteProperty(target, key);
    }
    return copy;
}

/** `a.0.b` + `c` → `a[].b.c`: one entry per field, not one per array row. */
function keyPath(path: readonly PropertyKey[], key: string): string {
    return [...path, key]
        .map((seg) => (typeof seg === 'number' ? '[]' : String(seg)))
        .join('.')
        .replaceAll('.[]', '[]');
}

function skewedKeys(issues: readonly ZodIssue[]): string[] {
    const keys = issues.flatMap((issue) =>
        isUnrecognizedKeys(issue) ? issue.keys.map((k) => keyPath(issue.path, k)) : [],
    );
    return [...new Set(keys)].sort();
}

/**
 * Records the skew as a Sentry breadcrumb on every call and, once per page
 * load, as a warning-level Sentry message (endpoint + key paths, never
 * values — a same-version server leaking a field stays visible) plus a
 * `sonner` toast offering a reload so the tab picks up the new bundle.
 */
export function reportVersionSkew(endpoint: string, issues: readonly ZodIssue[]): void {
    const keys = skewedKeys(issues);
    Sentry.addBreadcrumb({
        category: 'schema-skew',
        level: 'warning',
        message: SKEW_MESSAGE,
        data: { endpoint, keys },
    });
    if (noticeShown) return;
    noticeShown = true;
    Sentry.captureMessage(SKEW_MESSAGE, { level: 'warning', extra: { endpoint, keys } });
    toast.info(VERSION_SKEW_NOTICE, {
        id: VERSION_SKEW_TOAST_ID,
        duration: Infinity,
        action: { label: VERSION_SKEW_ACTION, onClick: () => window.location.reload() },
    });
}
