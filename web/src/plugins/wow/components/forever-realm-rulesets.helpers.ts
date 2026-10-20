/**
 * ROK-1739: pure helpers for the admin realm → ruleset editor — editable rows
 * (with a stable React key), the dirty check, and validation through the
 * contract schema (which de-duplicates on the shared `normalizeRealmName`).
 */
import {
    WOW_FOREVER_DEFAULT_REGION,
    WowForeverRealmRulesetsSchema,
    type WowForeverRealmRulesetEntryDto,
    type WowForeverRealmRulesetsDto,
} from '@raid-ledger/contract';

export interface RealmRulesetRow extends WowForeverRealmRulesetEntryDto {
    /** Client-only React key; never sent. */
    key: string;
}

/** Inline error per row, keyed by `RealmRulesetRow.key`. */
export type RealmRowErrors = Record<string, string>;

let rowSeq = 0;
function nextRowKey(): string {
    rowSeq += 1;
    return `realm-row-${rowSeq}`;
}

export function rowsFromSaved(saved: WowForeverRealmRulesetsDto): RealmRulesetRow[] {
    return saved.entries.map((entry) => ({ ...entry, key: nextRowKey() }));
}

export function blankRow(): RealmRulesetRow {
    return { key: nextRowKey(), region: WOW_FOREVER_DEFAULT_REGION, realmName: '', ruleset: 'normal' };
}

function entriesOf(rows: RealmRulesetRow[]): WowForeverRealmRulesetEntryDto[] {
    return rows.map(({ region, realmName, ruleset }) => ({ region, realmName, ruleset }));
}

/** True when the rows differ from the saved list (order included). */
export function isDirty(rows: RealmRulesetRow[], saved: WowForeverRealmRulesetsDto): boolean {
    if (rows.length !== saved.entries.length) return true;
    return rows.some((row, i) => {
        const s = saved.entries[i];
        return !s || s.region !== row.region || s.realmName !== row.realmName || s.ruleset !== row.ruleset;
    });
}

function rowMessage(code: string, message: string): string {
    if (code === 'too_small') return 'Enter the realm name';
    if (code === 'too_big') return 'Realm names are at most 100 characters';
    return message;
}

/**
 * Validate with the contract schema. Success → the PUT body (realm names
 * trimmed by the schema); failure → one message per offending row.
 */
export function validateRows(rows: RealmRulesetRow[]): { body?: WowForeverRealmRulesetsDto; errors: RealmRowErrors } {
    const parsed = WowForeverRealmRulesetsSchema.safeParse({ entries: entriesOf(rows) });
    if (parsed.success) return { body: parsed.data, errors: {} };
    const errors: RealmRowErrors = {};
    for (const issue of parsed.error.issues) {
        const [root, index] = issue.path;
        const row = root === 'entries' && typeof index === 'number' ? rows[index] : undefined;
        if (row) errors[row.key] ??= rowMessage(issue.code, issue.message);
    }
    return { errors };
}
