/**
 * Own-calendar busy band (NP-1) and radio cards (NP-2) for /dev/design-system
 * (ROK-1595, design-system §4.16 + §4.11).
 *
 * Mounts the REAL `CalendarBusyLayer` over a sample evening, the REAL
 * `DayPager` with its busy clause, and the REAL `RadioGroup` wearing the shipped
 * `RADIO_CARDS` classes. Nothing is a hand-drawn approximation.
 */
import { useState, type JSX } from 'react';
import type { CalendarReadMode, GameTimeCalendarBusy, GameTimeSlot } from '@raid-ledger/contract';
import { CalendarBusyLayer } from '../../components/features/game-time/CalendarBusyLayer';
import { DayPager } from '../../components/features/game-time/phone/DayPager';
import { RadioGroup } from '../../components/ui/radio-group';
import { READ_COPY } from '../../components/features/calendar-sync/calendar-sync.copy';
import { RADIO_CARDS } from '../../components/features/calendar-sync/radio-cards.classes';
import { Section, StateFrame } from './design-system-bits';

const HOURS = [18, 19, 20, 21, 22];
const DIMS = { colWidth: 200, rowHeight: 36, headerHeight: 0, colStartLeft: 0 };
const BUSY: GameTimeCalendarBusy[] = [{ dayOfWeek: 2, startHour: 20, endHour: 21, provider: 'google' }];
/** The sample's 7–10 PM free block — the band draws only inside game time (R5). */
const FREE: GameTimeSlot[] = [19, 20, 21].map((hour) => ({ dayOfWeek: 2, hour, status: 'available' }));
const noop = (): void => undefined;

/** A sample day: plain cells, a success free block, and the busy band over it. */
function SampleDay(): JSX.Element {
    return (
        <div className="relative w-[200px]" data-testid="ds-calendar-busy-day">
            {HOURS.map((h) => <div key={h} className="h-9 border-t border-edge bg-surface" />)}
            <div className="absolute inset-x-0 rounded-sm bg-success/30" style={{ top: 37, height: 106 }} />
            <CalendarBusyLayer busy={BUSY} slots={FREE} gridDims={DIMS} hours={HOURS} days={[2]} />
        </div>
    );
}

function RadioCards(): JSX.Element {
    const [mode, setMode] = useState<CalendarReadMode | 'off'>('both');
    const options = (['days', 'hours', 'both'] as const).map((m) => ({
        value: m, label: READ_COPY.modes[m].label, description: READ_COPY.modes[m].description,
    }));
    return (
        <RadioGroup<CalendarReadMode | 'off'> label={READ_COPY.desktopHeading} hideLabel options={options}
            value={mode} onChange={setMode} className={RADIO_CARDS} />
    );
}

export function CalendarBusySection(): JSX.Element {
    return (
        <Section
            id="calendar-busy"
            title="Pattern — own-calendar busy band and radio cards"
            blurb="The viewer's OWN synced busy hours are a translucent bg-busy band with a border-busy edge and 'Busy · Google Calendar', above their blocks and pointer-events-none. Group views keep the left-edge marker. Radio cards are the list RadioGroup in a grid."
        >
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <StateFrame label="Own busy band · CalendarBusyLayer" note="8–9 PM busy over a 7–10 PM free block.">
                    <SampleDay />
                </StateFrame>
                <StateFrame label="Day header · DayPager busy clause">
                    <DayPager day={2} freeHours={3} busyHours={1} onPrev={noop} onNext={noop} />
                </StateFrame>
            </div>
            <div className="mt-3">
                <StateFrame label="Radio cards · RADIO_CARDS (NP-2, §4.11)">
                    <RadioCards />
                </StateFrame>
            </div>
        </Section>
    );
}
