/**
 * ROK-1173 (AC7) — the profession coverage strip above the Members list:
 * "Professions known: X of N" (rows with any profession — a linked character's
 * or, ROK-2149 Q4=A, an unclaimed member's Armory snapshot) then one toggle chip per profession with at least
 * one member ("Enchanting: 8"). A chip toggles that profession in the Members
 * Profession filter. Members and staff only — it renders nothing when the
 * insights payload carries no `professions` (visitors, still loading). With
 * zero professions it shows the scope line, never "no professions".
 */
import type { JSX } from 'react';
import { FilterChip } from '../../../components/ui/filter-chip';
import type { HubMemberRow } from '../../hub-module';
import { rowProfessionKey } from '../lib/profession-member-key';
import type { ProfessionCoverage, ProfessionIndex } from './wow-member-filters.helpers';

export const PROFESSION_SCOPE_COPY = 'Professions from linked characters and the Blizzard Armory';

export interface WowProfessionCoverageProps {
    rows: readonly HubMemberRow[];
    /** `professionCoverage(insights.professions)`; undefined hides the strip. */
    professions: readonly ProfessionCoverage[] | undefined;
    /** `buildProfessionIndex(insights.professions)` — who has any profession. */
    index: ProfessionIndex;
    selected: readonly string[];
    onToggle: (name: string) => void;
}

export function WowProfessionCoverage({ rows, professions, index, selected, onToggle }: WowProfessionCoverageProps): JSX.Element | null {
    if (professions === undefined) return null;
    const known = rows.filter((row) => index.has(rowProfessionKey(row))).length;
    return (
        <section aria-label="Profession coverage" data-testid="wow-profession-coverage" className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-secondary" data-testid="wow-profession-coverage-linked">
                Professions known: {known} of {rows.length}
            </span>
            {professions.length === 0 ? (
                <span className="text-muted">· {PROFESSION_SCOPE_COPY}</span>
            ) : (
                professions.map((p) => (
                    <FilterChip
                        key={p.name}
                        label={`${p.name}: ${p.count}`}
                        pressed={selected.includes(p.name)}
                        onPressedChange={() => onToggle(p.name)}
                        testId={`wow-profession-chip-${p.name}`}
                    />
                ))
            )}
        </section>
    );
}
