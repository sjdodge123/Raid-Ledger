/**
 * ROK-1739: the admin "Realm rulesets" editor on the Blizzard integration
 * card — the realm → ruleset map an addon import falls back to when a
 * LedgerLink export carries no ruleset. Mounted OUTSIDE the "Blizzard
 * configured" gate: the map needs no Blizzard credentials.
 *
 * Whole-list edit, saved with one button; validated client-side with the
 * contract schema (duplicates via the shared `normalizeRealmName`), errors
 * inline on the offending row (design-system §4.11).
 */
import { useId, useState, type FormEvent, type JSX } from 'react';
import { WOW_FOREVER_REALM_RULESETS_MAX, type WowForeverRealmRulesetsDto } from '@raid-ledger/contract';
import { PlusIcon } from '@heroicons/react/24/outline';
import { toast } from '../../../lib/toast';
import { Button } from '../../../components/ui/button';
import { useForeverRealmRulesets } from '../hooks/use-forever-realm-rulesets';
import { REALM_ROW_GRID, RealmRulesetRowEditor } from './forever-realm-ruleset-row';
import {
    blankRow, isDirty, rowsFromSaved, validateRows,
    type RealmRowErrors, type RealmRulesetRow,
} from './forever-realm-rulesets.helpers';

type SaveFn = (dto: WowForeverRealmRulesetsDto) => Promise<unknown>;
type RowPatch = Parameters<typeof RealmRulesetRowEditor>[0]['onChange'];

async function submit(mutate: SaveFn, dto: WowForeverRealmRulesetsDto): Promise<void> {
    try {
        await mutate(dto);
        toast.success('Realm rulesets saved');
    } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to save realm rulesets');
    }
}

function RowList({ rows, errors, onChange, onRemove }: {
    rows: RealmRulesetRow[]; errors: RealmRowErrors; onChange: RowPatch; onRemove: (key: string) => void;
}): JSX.Element {
    if (rows.length === 0) return <p className="text-center py-6 text-sm text-muted">No realms mapped yet. Add one below.</p>;
    return (
        <div>
            <div aria-hidden="true" className={`hidden lg:grid mb-1 text-xs font-medium text-muted ${REALM_ROW_GRID}`}>
                <span>Region</span><span>Realm name</span><span>Ruleset</span><span className="w-11" />
            </div>
            <ul className="space-y-4 lg:space-y-2">
                {rows.map((row, i) => (
                    <li key={row.key}>
                        <RealmRulesetRowEditor row={row} index={i} error={errors[row.key]} onChange={onChange} onRemove={onRemove} />
                    </li>
                ))}
            </ul>
        </div>
    );
}

function RealmRulesetsForm({ saved, mutate, pending }: { saved: WowForeverRealmRulesetsDto; mutate: SaveFn; pending: boolean }): JSX.Element {
    const [rows, setRows] = useState(() => rowsFromSaved(saved));
    const [submitted, setSubmitted] = useState(false);
    const errors = submitted ? validateRows(rows).errors : {};
    const onChange: RowPatch = (key, patch) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    const onRemove = (key: string): void => setRows((prev) => prev.filter((r) => r.key !== key));
    const onSubmit = (e: FormEvent): void => {
        e.preventDefault();
        setSubmitted(true);
        const { body } = validateRows(rows);
        if (body) void submit(mutate, body);
    };
    return (
        <form onSubmit={onSubmit} noValidate className="space-y-3">
            <RowList rows={rows} errors={errors} onChange={onChange} onRemove={onRemove} />
            <div className="flex flex-wrap gap-2">
                <Button variant="secondary" disabled={rows.length >= WOW_FOREVER_REALM_RULESETS_MAX}
                    onClick={() => setRows((prev) => [...prev, blankRow()])}>
                    <PlusIcon aria-hidden="true" className="w-4 h-4" /> Add realm
                </Button>
                <Button type="submit" variant="primary" disabled={!isDirty(rows, saved)} loading={pending} loadingLabel="Saving..."
                    aria-label="Save realm rulesets">
                    Save
                </Button>
            </div>
        </form>
    );
}

/** The "Realm rulesets" section; the form re-mounts whenever the saved list changes. */
export function ForeverRealmRulesetsSection(): JSX.Element {
    const headingId = useId();
    const { rulesets, save } = useForeverRealmRulesets();
    const data = rulesets.data;
    return (
        <section aria-labelledby={headingId} className="mt-6 pt-6 border-t border-edge space-y-4">
            <div>
                <h3 id={headingId} className="text-base font-semibold text-foreground">Realm rulesets</h3>
                <p className="text-sm text-secondary">
                    When a LedgerLink export doesn&apos;t say which ruleset a character plays on, Raid Ledger looks its realm up here.
                </p>
            </div>
            {rulesets.isError && !data && <p role="alert" className="text-sm text-danger">Couldn&apos;t load the realm list. {rulesets.error.message}</p>}
            {data && <RealmRulesetsForm key={JSON.stringify(data.entries)} saved={data} mutate={save.mutateAsync} pending={save.isPending} />}
        </section>
    );
}
