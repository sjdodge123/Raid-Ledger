/**
 * ROK-1921 — the shared frame of the WoW: Forever roster widgets: the
 * "Mains only" switch on top, the body, then the freshness footer. Loading and
 * error states stay quiet (the card chrome is core's).
 */
import type { JSX, ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { WowRosterInsightsDto } from '@raid-ledger/contract';
import { Switch } from '../../../components/ui/switch';
import { QuietEmpty } from '../../../components/hub/card-bits';
import { FreshnessFooter } from './freshness-footer';

interface RosterWidgetShellProps {
    query: UseQueryResult<WowRosterInsightsDto, Error>;
    mainsOnly: boolean;
    onMainsOnly: (next: boolean) => void;
    children: (insights: WowRosterInsightsDto) => ReactNode;
}

/** The "Mains only" switch: linked members count once, by their main. */
export function MainsToggle({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }): JSX.Element {
    return (
        <div className="mb-3 flex items-center justify-end gap-2 text-xs text-secondary">
            <span aria-hidden="true">Mains only</span>
            <Switch checked={checked} onChange={onChange} label="Mains only" testId="forever-mains-only" />
        </div>
    );
}

/** Switch + body + freshness footer around one roster-insights query. */
export function RosterWidgetShell({ query, mainsOnly, onMainsOnly, children }: RosterWidgetShellProps): JSX.Element {
    const { data, isError } = query;
    return (
        <div aria-busy={query.isFetching}>
            <MainsToggle checked={mainsOnly} onChange={onMainsOnly} />
            {data !== undefined ? children(data) : (
                <QuietEmpty>{isError ? 'Roster stats are unavailable right now.' : 'Loading roster…'}</QuietEmpty>
            )}
            <FreshnessFooter freshness={data?.freshness.roster ?? null} />
        </div>
    );
}
