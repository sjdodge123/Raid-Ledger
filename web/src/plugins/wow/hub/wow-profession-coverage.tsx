/**
 * ROK-1173 (AC7) — the profession coverage strip above the Members list:
 * "Linked members: X of N" then one toggle chip per profession with at least
 * one member ("Enchanting: 8"). A chip toggles that profession in the Members
 * Profession filter. Members and staff only — it renders nothing when the
 * insights payload carries no `professions` (visitors, still loading). With
 * zero professions it shows the scope line, never "no professions".
 */
import type { JSX } from 'react';
import { FilterChip } from '../../../components/ui/filter-chip';
import type { HubMemberRow } from '../../hub-module';
import type { ProfessionCoverage } from './wow-member-filters.helpers';

export const PROFESSION_SCOPE_COPY = 'Professions show for linked characters with synced professions only';

export interface WowProfessionCoverageProps {
    rows: readonly HubMemberRow[];
    /** `professionCoverage(insights.professions)`; undefined hides the strip. */
    professions: readonly ProfessionCoverage[] | undefined;
    selected: readonly string[];
    onToggle: (name: string) => void;
}

export function WowProfessionCoverage({ rows, professions, selected, onToggle }: WowProfessionCoverageProps): JSX.Element | null {
    if (professions === undefined) return null;
    const linked = rows.filter((row) => row.characterId !== null).length;
    return (
        <section aria-label="Profession coverage" data-testid="wow-profession-coverage" className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-secondary" data-testid="wow-profession-coverage-linked">
                Linked members: {linked} of {rows.length}
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
