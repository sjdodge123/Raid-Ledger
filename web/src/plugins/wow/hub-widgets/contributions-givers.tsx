/**
 * ROK-2148 — "Top givers": a 30 days / All time segmented toggle, the guild
 * total, up to ten ranked players (medals for #1–3, a meter scaled to the
 * top giver) and the viewer's own row under the top 10 ("You" pill). Each row
 * is the shared `RankedMeterRow` with the medal `RankBadge` in its badge slot.
 */
import { useState, type JSX } from 'react';
import type { GuildContributionsGiver, GuildContributionsGivers } from '@raid-ledger/contract';
import { CharacterLink } from '../../../components/hub/character-link';
import { QuietEmpty } from '../../../components/hub/card-bits';
import { RankedMeterRow } from '../../../components/hub/ranked-meter-row';
import { RadioGroup } from '../../../components/ui/radio-group';
import { StatusChip } from '../../../components/ui/status-chip';
import { ContributionsSection } from './contributions-section';
import { RankBadge } from './contributions-rank';
import {
    GIVERS_EMPTY_30, GIVERS_EMPTY_ALL, GIVERS_EMPTY_HINT, GIVERS_ENCOURAGE, PERIOD_OPTIONS,
    formatCount, meterPct, totalSuffix, type ContributionsPeriod,
} from './contributions.helpers';

interface RowProps { giver: GuildContributionsGiver; top: number; as?: 'li' | 'div' }

function GiverRow({ giver, top, as = 'li' }: RowProps): JSX.Element {
    const top3 = giver.rank <= 3;
    const name = (
        <>
            <CharacterLink name={giver.characterName} characterId={giver.characterId} />
            {giver.isYou && <StatusChip tone="success" title="Your rank" className="ml-1">You</StatusChip>}
        </>
    );
    const items = (
        <span data-testid="contributions-giver-items" className={`whitespace-nowrap tabular-nums ${top3 ? 'font-semibold text-foreground' : ''}`}>
            {formatCount(giver.items)} items
        </span>
    );
    return (
        <RankedMeterRow as={as} testId={as === 'li' ? 'contributions-giver-row' : 'contributions-giver-you-row'}
            rank={giver.rank} badge={<RankBadge rank={giver.rank} />} name={name} trailing={items}
            pct={meterPct(giver.items, top)} meterLabel={`${giver.characterName}: ${giver.items} items`} />
    );
}

function GiversEmpty({ period }: { period: ContributionsPeriod }): JSX.Element {
    return (
        <QuietEmpty testId="contributions-givers-empty">
            <span className="block">{period === '30' ? GIVERS_EMPTY_30 : GIVERS_EMPTY_ALL}</span>
            <span className="mt-1 block">{GIVERS_EMPTY_HINT}</span>
        </QuietEmpty>
    );
}

interface ListProps { rows: readonly GuildContributionsGiver[]; you: GuildContributionsGiver | null }

function GiverList({ rows, you }: ListProps): JSX.Element {
    const top = rows[0]?.items ?? 0;
    return (
        <>
            <ol className="flex flex-col gap-2.5">
                {rows.map((g) => <GiverRow key={`${g.rank}-${g.characterName}`} giver={g} top={top} />)}
            </ol>
            {you !== null && (
                <div data-testid="contributions-giver-you" className="mt-2.5 border-t border-dashed border-edge pt-2.5">
                    <GiverRow as="div" giver={you} top={top} />
                </div>
            )}
            <p className="mt-2.5 text-xs text-muted">{GIVERS_ENCOURAGE}</p>
        </>
    );
}

export function ContributionsGivers({ givers }: { givers: GuildContributionsGivers }): JSX.Element {
    const [period, setPeriod] = useState<ContributionsPeriod>('30');
    const rows = period === '30' ? givers.last30Days : givers.allTime;
    const you = period === '30' ? givers.youLast30Days : givers.youAllTime;
    const total = period === '30' ? givers.last30DaysTotal : givers.allTimeTotal;
    const toggle = <RadioGroup label="Period" hideLabel appearance="segmented" options={PERIOD_OPTIONS} value={period} onChange={setPeriod} />;
    return (
        <ContributionsSection title="Top givers" testId="contributions-givers" action={toggle}>
            {rows.length === 0 ? <GiversEmpty period={period} /> : (
                <>
                    <p data-testid="contributions-givers-total" className="mb-2 text-xs text-muted">
                        <b className="font-semibold tabular-nums text-foreground">{formatCount(total)}</b> {totalSuffix(period, givers.countingSince)}
                    </p>
                    <GiverList rows={rows} you={you} />
                </>
            )}
        </ContributionsSection>
    );
}
