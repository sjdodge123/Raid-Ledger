/**
 * The "I'm away" panel (ROK-1585) — one component for every surface.
 * - `stacked`: Upcoming list → divider → "Add time away" form (phone drawer A, desktop modal).
 * - `inline`: the D1 card body — "I'm away · N upcoming" heading → rows → one add line.
 * A caller that pins the submit elsewhere passes its own `ctl` plus `hideSubmit`.
 */
import type { JSX } from 'react';
import { AwayAddForm } from './AwayAddForm';
import { AwayUpcomingList } from './AwayUpcomingList';
import { useAbsenceSection, type AbsenceSectionCtl } from './use-absence-section';

/** Props for `AwayPanel`. */
export interface AwayPanelProps {
    layout: 'stacked' | 'inline';
    hideSubmit?: boolean;
    ctl?: AbsenceSectionCtl;
}

type BodyProps = Omit<AwayPanelProps, 'ctl'> & { ctl: AbsenceSectionCtl };

function AwayPanelBody({ layout, hideSubmit = false, ctl }: BodyProps): JSX.Element {
    const list = (heading?: string) => (
        <AwayUpcomingList rows={ctl.rows} heading={heading} onRemove={ctl.remove} isDeleting={ctl.isDeleting} />
    );
    if (layout === 'inline') {
        return (
            <div data-testid="away-panel" data-layout="inline" className="flex flex-col gap-3">
                <h3 className="text-base font-semibold text-foreground">
                    I&apos;m away <span className="ml-2 text-sm font-normal text-dim">{ctl.rows.length} upcoming</span>
                </h3>
                {list()}
                <AwayAddForm layout="inline" ctl={ctl} hideSubmit={hideSubmit} />
            </div>
        );
    }
    return (
        <div data-testid="away-panel" data-layout="stacked" className="flex flex-col gap-4">
            {list('Upcoming')}
            <div className="border-t border-edge" />
            <AwayAddForm layout="stacked" ctl={ctl} hideSubmit={hideSubmit} />
        </div>
    );
}

function OwnedAwayPanel(props: Omit<AwayPanelProps, 'ctl'>): JSX.Element {
    const ctl = useAbsenceSection();
    return <AwayPanelBody {...props} ctl={ctl} />;
}

/** Renders with the caller's `ctl` when given, else owns a `useAbsenceSection`. */
export function AwayPanel({ ctl, ...rest }: AwayPanelProps): JSX.Element {
    return ctl ? <AwayPanelBody {...rest} ctl={ctl} /> : <OwnedAwayPanel {...rest} />;
}
