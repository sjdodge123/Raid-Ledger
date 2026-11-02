import type { JSX } from 'react';
import type { CharacterDto, CharacterRole, SeriesSignupStateDto } from '@raid-ledger/contract';
import { Checkbox } from '../../ui/checkbox';
import { Field } from '../../ui/field';
import { Select } from '../../ui/select';
import { RoleIcon } from '../../shared/RoleIcon';
import { formatNightDate, keptNightCount } from './series-signup-format';
import type { JoinSeriesSelection } from './use-join-series-selection';

const ROLES: readonly CharacterRole[] = ['tank', 'healer', 'dps'];
const ROLE_LABEL: Record<CharacterRole, string> = { tank: 'Tank', healer: 'Healer', dps: 'DPS' };

function JoinSummary({ state, startsTonight }: { state: SeriesSignupStateDto; startsTonight: boolean }): JSX.Element {
    const kept = keptNightCount(state);
    const range = state.firstNight && state.lastNight
        ? ` (${formatNightDate(state.firstNight)} → ${formatNightDate(state.lastNight)})` : '';
    return (
        <div className="space-y-1">
            <p className="text-sm text-foreground">
                You&apos;ll be signed up for <strong>{state.joinableCount} upcoming {state.joinableCount === 1 ? 'night' : 'nights'}</strong>
                {range}{startsTonight ? ', starting with this one' : ''}.
            </p>
            {kept > 0 && (
                <p className="text-sm text-muted" data-testid="join-series-kept">
                    {kept === 1 ? '1 night you declined stays declined.' : `${kept} nights you declined stay declined.`}
                </p>
            )}
        </div>
    );
}

function RolePicker({ selection }: { selection: JoinSeriesSelection }): JSX.Element {
    return (
        <fieldset>
            <legend className="text-sm font-medium text-foreground mb-1">Roles you can play</legend>
            <div className="flex flex-wrap gap-x-4">
                {ROLES.map((r) => (
                    <Checkbox key={r} checked={selection.roles.includes(r)} onChange={() => selection.toggleRole(r)}
                        label={<span className="inline-flex items-center gap-1.5"><RoleIcon role={r} size="w-5 h-5" />{ROLE_LABEL[r]}</span>} />
                ))}
            </div>
        </fieldset>
    );
}

/** The join overlay body both shells render: night count, date range, character, roles. */
export function JoinSeriesBody({ state, startsTonight, characters, selection, hasRoles }: {
    state: SeriesSignupStateDto; startsTonight: boolean; characters: CharacterDto[];
    selection: JoinSeriesSelection; hasRoles: boolean;
}): JSX.Element {
    return (
        <div className="space-y-4">
            <JoinSummary state={state} startsTonight={startsTonight} />
            {characters.length > 0 && (
                <Field label="Character">
                    <Select value={selection.characterId ?? ''} onChange={(e) => selection.selectCharacter(e.target.value)}>
                        {characters.map((c) => <option key={c.id} value={c.id}>{c.class ? `${c.name} · ${c.class}` : c.name}</option>)}
                    </Select>
                </Field>
            )}
            {hasRoles && <RolePicker selection={selection} />}
            <p className="text-xs text-muted">You can skip any single night later, or leave the series at any time.</p>
        </div>
    );
}
