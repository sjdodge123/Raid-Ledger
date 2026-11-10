import { Fragment, type JSX } from 'react';
import type { HeatmapCellData } from './game-time-grid.types';
import { groupCellCountClauses } from './phone/group-day.utils';

/**
 * The group heatmap's count line (desktop week cell AND phone day cell), in
 * `free · busy · stale` order (ROK-2167 ruling, option A). Each clause is a
 * `whitespace-nowrap` span and the clauses are joined by a plain space, so a
 * chip too narrow for the line wraps BETWEEN clauses — the next line starts
 * "· 8 stale" — and never inside one. The busy clause is `text-busy`.
 */
export function GroupCountClauses({ cell }: { cell: HeatmapCellData }): JSX.Element {
    return (
        <>
            {groupCellCountClauses(cell).map((clause, i) => (
                <Fragment key={clause.kind}>
                    {i > 0 && ' '}
                    <span className={clause.kind === 'busy' ? 'whitespace-nowrap font-medium text-busy' : 'whitespace-nowrap'}>
                        {i > 0 ? `· ${clause.text}` : clause.text}
                    </span>
                </Fragment>
            ))}
        </>
    );
}
