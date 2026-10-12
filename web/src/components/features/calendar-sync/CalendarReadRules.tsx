/**
 * "When a calendar says you are busy" (ROK-1595): K2's two switches + "Look
 * ahead" below 1024px, K4's three radio cards from 1024px (spec D2). Without
 * the read grant both are replaced by "Grant read access". A broken
 * connection (`needs_reconnect`) keeps the rows but disables them; the row's
 * "Fix" is the way out. Saving is immediate — see `use-read-rules.ts`.
 */
import { useId, type JSX } from 'react';
import { CALENDAR_LOOK_AHEAD_WEEKS, type CalendarConnection, type CalendarReadMode } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { Switch } from '../../ui/switch';
import { RadioGroup } from '../../ui/radio-group';
import { useStartOAuth } from '../../../hooks/use-calendar-sync';
import { readGranted, switchesOf, modeOf, useReadRules, type ReadSwitches } from './use-read-rules';
import { READ_COPY as R } from './calendar-sync.copy';

interface RulesProps { connection: CalendarConnection; mode: CalendarReadMode; desktop: boolean }

interface SwitchRowProps { copy: { title: string; sub: string; aria: string }; checked: boolean; disabled: boolean; testId: string; onChange: (on: boolean) => void }

function SwitchRow({ copy, checked, disabled, testId, onChange }: SwitchRowProps): JSX.Element {
    const subId = useId();
    return (
        <div className="flex items-start justify-between gap-3 py-2.5">
            <div className="min-w-0">
                <p className="text-base text-foreground">{copy.title}</p>
                <p id={subId} className="text-xs text-muted">{copy.sub}</p>
            </div>
            <Switch checked={checked} onChange={onChange} label={copy.aria} aria-describedby={subId}
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

interface ControlProps { switches: ReadSwitches; mode: CalendarReadMode; enabled: boolean; disabled: boolean; choose: (next: CalendarReadMode | null) => void }

function PhoneSwitches({ switches, disabled, choose }: ControlProps): JSX.Element {
    const flip = (key: keyof ReadSwitches) => (on: boolean): void => choose(modeOf({ ...switches, [key]: on }));
    return (
        <div>
            <SwitchRow copy={R.days} checked={switches.days} disabled={disabled} testId="calendar-read-days" onChange={flip('days')} />
            <SwitchRow copy={R.hours} checked={switches.hours} disabled={disabled} testId="calendar-read-hours" onChange={flip('hours')} />
            <LookAheadRow />
        </div>
    );
}

const MODES: readonly CalendarReadMode[] = ['days', 'hours', 'both'];
/** NP-2 radio cards: the list `RadioGroup` in a 3-column grid, each option a bordered card; ON = `border-success`. */
const CARDS = '[&>div]:grid [&>div]:grid-cols-3 [&>div]:gap-3 [&_label]:rounded-lg [&_label]:border [&_label]:border-edge '
    + '[&_label]:bg-panel [&_label]:px-3 [&_label:has(:checked)]:border-success';

function DesktopCards({ mode, enabled, disabled, choose }: ControlProps): JSX.Element {
    const options = MODES.map((m) => ({ value: m, label: R.modes[m].label, description: R.modes[m].description }));
    return (
        <RadioGroup<CalendarReadMode | 'off'> label={R.desktopHeading} hideLabel options={options}
            value={enabled ? mode : 'off'} onChange={(m) => choose(m === 'off' ? null : m)} disabled={disabled}
            className={CARDS} />
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

function ReadControls({ connection, mode, desktop }: RulesProps): JSX.Element {
    const { choose, failed, busy, enabled } = useReadRules(connection, mode);
    const props: ControlProps = {
        switches: switchesOf(mode, enabled), mode, enabled, choose,
        disabled: busy || connection.status === 'needs_reconnect',
    };
    return (
        <>
            {desktop ? <DesktopCards {...props} /> : <PhoneSwitches {...props} />}
            {failed && <p role="alert" className="text-sm text-danger" data-testid="calendar-read-error">{R.saveFailed}</p>}
        </>
    );
}

/** One connection's read rules, as a page section card. */
export function CalendarReadRules({ connection, mode, desktop }: RulesProps): JSX.Element {
    return (
        <section className="bg-surface border border-edge-subtle rounded-xl p-4 space-y-3"
            data-testid="calendar-read-rules" data-connection-id={connection.id} data-layout={desktop ? 'cards' : 'switches'}>
            <h3 className="text-sm font-semibold text-foreground">{desktop ? R.desktopHeading : R.phoneHeading}</h3>
            {readGranted(connection)
                ? <ReadControls connection={connection} mode={mode} desktop={desktop} />
                : <GrantRead />}
        </section>
    );
}
