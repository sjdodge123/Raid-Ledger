/**
 * ROK-1789 — the Recruitment editor's wanted rows (the SessionNoteItemsEditor
 * idiom, design-system §3.2: one input row each, ghost remove). Each row is
 * Select class + Select role + Select state + Input note + remove. ≥1024px it
 * is one 5-column row; below, two lines (class + role + remove, then state +
 * note). "Add class" is disabled at the 12-row cap; a repeated class + role
 * shows its error under the repeat row.
 */
import type { JSX } from 'react';
import { PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
import {
    GUILD_RECRUIT_NOTE_MAX, GUILD_RECRUIT_WANTED_MAX, GUILD_RECRUITMENT_STATES,
    type CharacterRole, type GuildRecruitmentState, type WowRecruitClass,
} from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { RECRUIT_ROLES, RECRUIT_ROLE_LABEL, RECRUIT_STATE_META, wantedOps, type DraftWanted } from './recruitment.helpers';

type RowsUpdate = (next: (rows: DraftWanted[]) => DraftWanted[]) => void;

interface RowProps {
    row: DraftWanted;
    index: number;
    classes: readonly WowRecruitClass[];
    error: string | undefined;
    onChange: RowsUpdate;
}

const isClass = (classes: readonly WowRecruitClass[], v: string): v is WowRecruitClass => classes.some((c) => c === v);
const isRole = (v: string): v is CharacterRole => RECRUIT_ROLES.some((r) => r === v);
const isState = (v: string): v is GuildRecruitmentState => GUILD_RECRUITMENT_STATES.some((s) => s === v);

function RowControls({ row, index, classes, error, onChange }: RowProps): JSX.Element {
    const set = (patch: Partial<Omit<DraftWanted, 'key'>>): void => onChange((rows) => wantedOps.patch(rows, row.key, patch));
    const invalid = error !== undefined;
    const n = index + 1;
    return (
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2 lg:grid-cols-[1fr_1fr_1fr_1.4fr_auto]">
            <div className="col-start-1 row-start-1 min-w-0">
                <Select aria-label={`Class ${n}`} data-testid={`recruitment-class-${index}`} value={row.className} invalid={invalid}
                    onChange={(e) => { const v = e.target.value; if (isClass(classes, v)) set({ className: v }); }}>
                    {classes.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
            </div>
            <div className="col-start-2 row-start-1 min-w-0">
                <Select aria-label={`Role ${n}`} data-testid={`recruitment-role-${index}`} value={row.role} invalid={invalid}
                    onChange={(e) => { const v = e.target.value; if (isRole(v)) set({ role: v }); }}>
                    {RECRUIT_ROLES.map((r) => <option key={r} value={r}>{RECRUIT_ROLE_LABEL[r]}</option>)}
                </Select>
            </div>
            <div className="col-start-1 row-start-2 min-w-0 lg:col-start-3 lg:row-start-1">
                <Select aria-label={`State ${n}`} data-testid={`recruitment-state-${index}`} value={row.state}
                    onChange={(e) => { const v = e.target.value; if (isState(v)) set({ state: v }); }}>
                    {GUILD_RECRUITMENT_STATES.map((s) => <option key={s} value={s}>{RECRUIT_STATE_META[s].label}</option>)}
                </Select>
            </div>
            <div className="col-span-2 col-start-2 row-start-2 min-w-0 lg:col-span-1 lg:col-start-4 lg:row-start-1">
                <Input aria-label={`Note ${n}`} data-testid={`recruitment-note-${index}`} value={row.note}
                    maxLength={GUILD_RECRUIT_NOTE_MAX} placeholder="Note (optional)"
                    onChange={(e) => set({ note: e.target.value })} />
            </div>
            <Button variant="ghost" iconOnly className="col-start-3 row-start-1 shrink-0 lg:col-start-5"
                aria-label={`Remove ${row.className} ${RECRUIT_ROLE_LABEL[row.role]}`} data-testid={`recruitment-remove-${index}`}
                onClick={() => onChange((rows) => wantedOps.remove(rows, row.key))}>
                <XMarkIcon className="h-5 w-5" aria-hidden="true" />
            </Button>
        </div>
    );
}

export interface RecruitmentWantedEditorProps {
    rows: DraftWanted[];
    classes: readonly WowRecruitClass[];
    /** Duplicate-pair errors keyed by row key (`draftErrors(...).rows`). */
    errors: ReadonlyMap<number, string>;
    onChange: RowsUpdate;
}

/** The wanted-classes list with Add class; rows edit through `wantedOps`. */
export function RecruitmentWantedEditor({ rows, classes, errors, onChange }: RecruitmentWantedEditorProps): JSX.Element {
    return (
        <fieldset className="flex flex-col gap-2" data-testid="recruitment-wanted-editor">
            <legend className="mb-1 text-sm font-medium text-foreground">
                Wanted classes <span className="text-muted">({rows.length} of {GUILD_RECRUIT_WANTED_MAX})</span>
            </legend>
            {rows.length > 0 && (
                <ul className="flex flex-col gap-3">
                    {rows.map((row, i) => {
                        const error = errors.get(row.key);
                        return (
                            <li key={row.key} className="flex flex-col gap-1" data-testid={`recruitment-row-${i}`}>
                                <RowControls row={row} index={i} classes={classes} error={error} onChange={onChange} />
                                {error !== undefined && <p className="text-xs text-danger" data-testid={`recruitment-row-error-${i}`}>{error}</p>}
                            </li>
                        );
                    })}
                </ul>
            )}
            <div>
                <Button variant="secondary" size="sm" data-testid="recruitment-add-row" disabled={rows.length >= GUILD_RECRUIT_WANTED_MAX}
                    onClick={() => onChange((current) => wantedOps.add(current, classes))}>
                    <PlusIcon className="h-4 w-4" aria-hidden="true" /> Add class
                </Button>
            </div>
            <p className="text-xs text-muted">Up to {GUILD_RECRUIT_WANTED_MAX}, each with its own state.</p>
        </fieldset>
    );
}
