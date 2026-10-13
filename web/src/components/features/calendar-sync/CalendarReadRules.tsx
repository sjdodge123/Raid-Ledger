/**
 * "When a calendar says you are busy" (ROK-1595): K2's two switches + "Look
 * ahead" below 1024px, K4's three radio cards from 1024px (spec D2). The mode
 * is per USER, so this renders once for the page, not for one connection.
 * With two or more readable accounts the switches only pick the mode: the
 * last one on is locked with a hint (each card has its own on/off).
 * Without any account that reads it is "Grant read access". When every
 * account that reads is broken (`needs_reconnect`) the rows stay but are
 * disabled; the row's "Fix" is the way out. Saving is immediate — see
 * `use-read-rules.ts`.
 */
import { useId, type JSX } from 'react';
import { CALENDAR_LOOK_AHEAD_WEEKS, type CalendarConnection, type CalendarReadMode } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { Switch } from '../../ui/switch';
import { RadioGroup } from '../../ui/radio-group';
import { useStartOAuth } from '../../../hooks/use-calendar-sync';
import { readableConnections, switchesOf, modeOf, useReadMode, type ReadSwitches } from './use-read-rules';
import { READ_COPY as R } from './calendar-sync.copy';
import { RADIO_CARDS } from './radio-cards.classes';

interface RulesProps { connections: readonly CalendarConnection[]; mode: CalendarReadMode; desktop: boolean }

interface SwitchRowProps {
    copy: { title: string; sub: string; aria: string }; checked: boolean; disabled: boolean; testId: string;
    onChange: (on: boolean) => void;
    /** Extra description (the keep-one hint) for a switch locked on. */
    hintId?: string | undefined;
}

function SwitchRow({ copy, checked, disabled, testId, onChange, hintId }: SwitchRowProps): JSX.Element {
    const subId = useId();
    return (
        <div className="flex items-start justify-between gap-3 py-2.5">
            <div className="min-w-0">
                <p className="text-base text-foreground">{copy.title}</p>
                <p id={subId} className="text-xs text-muted">{copy.sub}</p>
            </div>
            <Switch checked={checked} onChange={onChange} label={copy.aria} aria-describedby={hintId ? `${subId} ${hintId}` : subId}
                disabled={disabled} testId={testId} />
        </div>
    );
}

function LookAheadRow(): JSX.Element {
    return (
        <div className="flex items-center justify-between gap-3 py-2.5" data-testid="calendar-read-look-ahead">
            <div className="min-w-0">
                <p className="text-base text-foreground">{R.lookAhead}</p>
                <p className="text-xs text-muted">{R.lookAheadSub}</p>
            </div>
            <span className="rounded-full bg-overlay px-2 py-0.5 text-xs text-muted">{R.lookAheadTag(CALENDAR_LOOK_AHEAD_WEEKS)}</span>
        </div>
    );
}

interface ControlProps {
    switches: ReadSwitches; mode: CalendarReadMode; enabled: boolean; disabled: boolean; multi: boolean;
    choose: (next: CalendarReadMode | null) => void;
}

function PhoneSwitches({ switches, disabled, multi, choose }: ControlProps): JSX.Element {
    const flip = (key: keyof ReadSwitches) => (on: boolean): void => choose(modeOf({ ...switches, [key]: on }));
    // 2+ accounts: the page switches set WHAT counts and cannot both be off (operator 2026-10-13).
    const keepOne = multi && switches.days !== switches.hours;
    const keepOneId = useId();
    const hintFor = (on: boolean): string | undefined => (keepOne && on ? keepOneId : undefined);
    return (
        <div>
            <SwitchRow copy={R.days} checked={switches.days} disabled={disabled || (keepOne && switches.days)}
                testId="calendar-read-days" onChange={flip('days')} hintId={hintFor(switches.days)} />
            <SwitchRow copy={R.hours} checked={switches.hours} disabled={disabled || (keepOne && switches.hours)}
                testId="calendar-read-hours" onChange={flip('hours')} hintId={hintFor(switches.hours)} />
            {keepOne && <p id={keepOneId} className="text-xs text-muted" data-testid="calendar-read-keep-one">{R.keepOne}</p>}
            <LookAheadRow />
        </div>
    );
}

const MODES: readonly CalendarReadMode[] = ['days', 'hours', 'both'];
/** NP-2 radio cards: classes in `radio-cards.classes.ts`. */

function DesktopCards({ mode, enabled, disabled, choose }: ControlProps): JSX.Element {
    const options = MODES.map((m) => ({ value: m, label: R.modes[m].label, description: R.modes[m].description }));
    return (
        <RadioGroup<CalendarReadMode | 'off'> label={R.desktopHeading} hideLabel options={options}
            value={enabled ? mode : 'off'} onChange={(m) => choose(m === 'off' ? null : m)} disabled={disabled}
            className={RADIO_CARDS} />
    );
}

function GrantRead(): JSX.Element {
    const grant = useStartOAuth('read');
    return (
        <div className="flex flex-wrap items-center justify-between gap-3" data-testid="calendar-read-grant">
            <p className="text-sm text-secondary">{R.grantTitle}</p>
            <Button variant="secondary" loading={grant.isPending} loadingLabel={R.granting} onClick={() => grant.mutate()}
                data-testid="calendar-read-grant-button">
                {R.grant}
            </Button>
            {grant.isError && <p role="alert" className="w-full text-sm text-danger">{R.fixFailed}</p>}
        </div>
    );
}

interface ControlsProps { readable: readonly CalendarConnection[]; mode: CalendarReadMode; desktop: boolean }

function ReadControls({ readable, mode, desktop }: ControlsProps): JSX.Element {
    const { choose, failed, busy, enabled, multi } = useReadMode(readable, mode);
    const props: ControlProps = {
        switches: switchesOf(mode, enabled), mode, enabled, multi, choose,
        disabled: busy || readable.every((c) => c.status === 'needs_reconnect'),
    };
    return (
        <>
            {desktop ? <DesktopCards {...props} /> : <PhoneSwitches {...props} />}
            {failed && <p role="alert" className="text-sm text-danger" data-testid="calendar-read-error">{R.saveFailed}</p>}
        </>
    );
}

/** The user's read rules, as one page section card (`connections` = the live ones). */
export function CalendarReadRules({ connections, mode, desktop }: RulesProps): JSX.Element {
    const readable = readableConnections(connections);
    return (
        <section className="bg-surface border border-edge-subtle rounded-xl p-4 space-y-3"
            data-testid="calendar-read-rules" data-layout={desktop ? 'cards' : 'switches'}>
            <h3 className="text-sm font-semibold text-foreground">{desktop ? R.desktopHeading : R.phoneHeading}</h3>
            {readable.length > 0
                ? <ReadControls readable={readable} mode={mode} desktop={desktop} />
                : <GrantRead />}
        </section>
    );
}
