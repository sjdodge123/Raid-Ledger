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
            </StateGrid>
        </Section>
    );
}
