/**
 * ROK-2148 — the "Guild contributions" card body (approved mockup
 * `planning-artifacts/ROK-2148-guild-contributions-mockup.html`): profession
 * masters, top givers (30 days / All time) and Mailworthy users, stacked in
 * one column at every width, then the LedgerLink freshness line. Default
 * export so the registration can `React.lazy` it.
 */
import type { JSX } from 'react';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { useGuildContributions } from '../hooks/use-guild-contributions';
import { FreshnessFooter } from './freshness-footer';
import { ContributionsMasters } from './contributions-masters';
import { ContributionsGivers } from './contributions-givers';
import { ContributionsUsers } from './contributions-users';

export default function ContributionsWidget({ page }: HubWidgetCtx): JSX.Element | null {
    const { data } = useGuildContributions(page.guild.id);
    if (data === undefined) return null;
    return (
        <div data-testid="contributions-card">
            <div className="flex flex-col divide-y divide-edge-subtle">
                <ContributionsMasters template={data.template} masters={data.masters} />
                <ContributionsGivers givers={data.givers} />
                <ContributionsUsers users={data.users} />
            </div>
            <FreshnessFooter freshness={{ source: 'addon', asOf: data.givers.asOf }} testId="contributions-freshness" />
        </div>
    );
}
