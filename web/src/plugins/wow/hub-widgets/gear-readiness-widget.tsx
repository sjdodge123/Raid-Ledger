/**
 * ROK-1915 (W7 + W8) — WoW: Forever "Gear readiness" Overview card body: the
 * §4.30 item-level histogram over linked level-60 mains with "Median N ·
 * floor F", a collapsed "Below floor" list, a collapsed "Missing enchants"
 * list (slot names per main), the "N unknown" line for old schema-1
 * LedgerLink exports, and the shared `FreshnessFooter`. Nothing reported yet
 * shows the quiet §4.5 line (AC6). Core draws the `WidgetCard` chrome; the
 * registration (`gear-readiness.register.ts`) gates it to members + staff.
 */
import type { JSX } from 'react';
import type { WowRosterGearDto } from '@raid-ledger/contract';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { FreshnessFooter } from './freshness-footer';
import { BelowFloorSection, GearHistogram, GearSectionLabel, MissingEnchantsSection } from './gear-readiness-rows';
import { gearMeta, isGearEmpty } from './gear-readiness.helpers';
import { useRosterInsights } from './use-roster-insights';

/** AC6 copy, verbatim. */
export const GEAR_EMPTY_COPY = "No gear yet — each player's LedgerLink character export fills this card.";

/** The Gear readiness widget body (lazy-loaded). */
export default function GearReadinessWidget({ page }: Pick<HubWidgetCtx, 'page'>): JSX.Element {
    const { data, isPending, isError } = useRosterInsights(page.guild.id, false);
    if (isPending) return <div className="h-24 animate-pulse rounded-md bg-panel" />;
    if (isError) return <p role="alert" className="text-sm text-muted">Couldn't load gear readiness.</p>;
    const gear = data.gear;
    const footer = <FreshnessFooter freshness={gear?.freshness ?? null} />;
    if (gear === undefined || isGearEmpty(gear)) {
        return (
            <div data-testid="gear-readiness-empty" className="flex flex-col">
                <p className="text-sm text-muted">{GEAR_EMPTY_COPY}</p>
                {footer}
            </div>
        );
    }
    return (
        <div data-testid="gear-readiness" className="flex flex-col">
            <ItemLevel ilvl={gear.ilvl} />
            <Enchants enchants={gear.enchants} />
            {footer}
        </div>
    );
}

function ItemLevel({ ilvl }: { ilvl: WowRosterGearDto['ilvl'] }): JSX.Element {
    return (
        <section>
            <GearSectionLabel>Item level · level 60 mains</GearSectionLabel>
            {ilvl.reporters > 0 && <GearHistogram buckets={ilvl.buckets} />}
            <p data-testid="gear-meta" className="mb-1.5 mt-1.5 text-xs text-muted">{gearMeta(ilvl)}</p>
            <BelowFloorSection ilvl={ilvl} />
        </section>
    );
}

function Enchants({ enchants }: { enchants: WowRosterGearDto['enchants'] }): JSX.Element {
    return (
        <section>
            <GearSectionLabel>Missing enchants</GearSectionLabel>
            <MissingEnchantsSection enchants={enchants} />
            {enchants.unknown > 0 && (
                <p data-testid="gear-unknown" className="mt-1.5 text-xs text-muted">
                    {enchants.unknown} unknown — re-export from LedgerLink to check enchants.
                </p>
            )}
        </section>
    );
}
