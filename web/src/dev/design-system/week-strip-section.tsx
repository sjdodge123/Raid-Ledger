/**
 * Week strip for /dev/design-system (ROK-1586 §5.1, pattern §4.15).
 *
 * Fills come from the SHIPPED maps in `week-strip.fills.ts` (`BAND_FILL`,
 * `GROUP_FILL`, `GROUP_GRADIENT` — exported for exactly this, OQ-8). `BandBar`
 * itself stays module-local, so the bar below is a minimal literal composition
 * that mirrors `WeekStrip.tsx::BandBar` (`:201-225`): 5px bar, `.strip-bar-split`
 * driven by `--bar-l` / `--bar-r` for a two-tone band, and the busy cap on the
 * right 30%. If BandBar's markup changes, change this with it.
 */
import type { CSSProperties, JSX } from 'react';
import {
    BAND_FILL,
    GROUP_FILL,
    GROUP_GRADIENT,
} from '../../components/features/game-time/phone/week-strip.fills';
import type { GroupBandKind } from '../../components/features/game-time/phone/group-day.utils';
import type { BandKind } from '../../components/features/game-time/phone/phone-week.utils';
import { WeekStrip } from '../../components/features/game-time/phone/WeekStrip';
import type { AwayRowItem, AwaySource } from '../../components/features/game-time/away/away-row.types';
import { AwayUpcomingList } from '../../components/features/game-time/away/AwayUpcomingList';
import { Section, StateFrame, StateGrid } from './design-system-bits';

const GROUP_KINDS: GroupBandKind[] = ['all', 'most', 'few', 'none'];
const SELF_KINDS: BandKind[] = ['full', 'partial', 'none'];
const BAR = 'relative block h-[5px] w-16 overflow-hidden rounded-[1px]';

/** One bar — solid fill, or two tones split by a sliver of the surface. */
function DemoBar({ fill, split, busy, testId }: {
    fill?: string;
    split?: [GroupBandKind, GroupBandKind];
    busy?: boolean;
    testId?: string;
}): JSX.Element {
    const style = split
        ? { '--bar-l': GROUP_GRADIENT[split[0]], '--bar-r': GROUP_GRADIENT[split[1]] } as CSSProperties
        : undefined;
    return (
        <i data-testid={testId} className={`${BAR} ${split ? 'strip-bar-split' : fill}`} style={style}>
            {busy && <span data-busy="true" className="absolute inset-y-0 right-0 w-[30%] bg-busy" />}
        </i>
    );
}

function Labelled({ label, children }: { label: string; children: JSX.Element }): JSX.Element {
    return (
        <span className="inline-flex flex-col items-start gap-1">
            {children}
            <code className="text-[10px] text-dim">{label}</code>
        </span>
    );
}

function GroupRamp(): JSX.Element {
    return (
        <StateFrame label="Group ramp — all / most / few / none" note="GROUP_FILL: success → warning/70 → danger/50 → edge.">
            {GROUP_KINDS.map((k) => (
                <Labelled key={k} label={`${k} · ${GROUP_FILL[k]}`}>
                    <DemoBar fill={GROUP_FILL[k]} testId={`ds-strip-group-${k}`} />
                </Labelled>
            ))}
        </StateFrame>
    );
}

function SelfRamp(): JSX.Element {
    return (
        <StateFrame label="Your own week — full / partial / none" note="BAND_FILL: success → success/50 → edge.">
            {SELF_KINDS.map((k) => (
                <Labelled key={k} label={`${k} · ${BAND_FILL[k]}`}>
                    <DemoBar fill={BAND_FILL[k]} testId={`ds-strip-self-${k}`} />
                </Labelled>
            ))}
        </StateFrame>
    );
}

function SplitAndBusy(): JSX.Element {
    return (
        <StateFrame label="Two-tone split · busy cap"
            note="Split: hours disagree, both tones across a sliver of --color-surface. Cap: a committed hour, right 30%, bg-busy.">
            <Labelled label="most | few"><DemoBar split={['most', 'few']} testId="ds-strip-split" /></Labelled>
            <Labelled label="all + busy"><DemoBar fill={GROUP_FILL.all} busy testId="ds-strip-busy" /></Labelled>
            <Labelled label="all | most + busy"><DemoBar split={['all', 'most']} busy /></Labelled>
        </StateFrame>
    );
}

const AWAY_DEMO = new Map<number, AwaySource>([[4, 'calendar'], [6, 'manual']]);
const noop = (): void => {};

/** ROK-1595 S2: the real strip — Sat a manual away tile, Thu the quiet synced (calendar) one. */
function AwayTiles(): JSX.Element {
    return (
        <StateFrame label="Away tiles · manual (Sat) · calendar (Thu)"
            note="Manual: dashed edge-strong on overlay/40. Calendar (synced): the same dashed border on no fill, plus a calendar glyph.">
            <div className="w-72" data-testid="ds-strip-away">
                <WeekStrip slots={[]} hours={[19, 20, 21]} day={2} onPick={noop} awayDays={AWAY_DEMO} />
            </div>
        </StateFrame>
    );
}

const AWAY_ROWS: AwayRowItem[] = [
    { key: 'm', id: 1, startDate: '2026-10-17', endDate: '2026-10-18', reason: 'Camping', source: 'manual', provider: null },
    { key: 'c', id: 2, startDate: '2026-10-15', endDate: '2026-10-15', reason: null, source: 'calendar', provider: 'google' },
];

/** NP-3: the real away list — a manual row (Remove) above the quiet synced row (Ignore). */
function AwayRows(): JSX.Element {
    return (
        <StateFrame label="Away rows · manual · synced (quiet)"
            note="Synced row: border-edge-subtle on no fill, muted title, Ignore instead of Remove, under 'From your calendars'.">
            <div className="w-72" data-testid="ds-away-rows">
                <AwayUpcomingList rows={AWAY_ROWS} heading="Coming up" syncedText="Synced 4 min ago"
                    onRemove={noop} onIgnore={noop} isDeleting={false} />
            </div>
        </StateFrame>
    );
}

/** The strip's colour language, painted from the maps the strip itself uses. */
export function WeekStripSection(): JSX.Element {
    return (
        <Section
            id="week-strip"
            title="Pattern — week strip"
            blurb="Three bands per day. The group ramp is success → warning → danger, the same language as the heatmap cells — never a second colour language for the same data."
        >
            <StateGrid>
                <GroupRamp />
                <SelfRamp />
                <SplitAndBusy />
                <AwayTiles />
                <AwayRows />
            </StateGrid>
        </Section>
    );
}
