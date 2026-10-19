/** ROK-1787 — weekly raid schedule (prototype `proposed/RaidSchedule.tsx`): one row per recurring series. */
import type { JSX } from 'react';
import type { GuildKind, GuildScheduleNightDto } from '@raid-ledger/contract';
import { hubCopy } from '../hub-copy';
import { Pill, WidgetCard } from '../hub-bits';
import { timeRange, weekdayShort } from './guild-raids.helpers';
import { CardFootnote, QuietEmpty } from '../card-bits';

const FREQUENCY: Record<NonNullable<GuildScheduleNightDto['frequency']>, string> = {
    weekly: 'Weekly',
    biweekly: 'Every 2 weeks',
    monthly: 'Monthly',
};

function NightRow({ night }: { night: GuildScheduleNightDto }): JSX.Element {
    const often = night.frequency ? ` · ${FREQUENCY[night.frequency]}` : '';
    return (
        <li data-testid="guild-schedule-night" className="flex items-center gap-3 rounded-lg border border-edge bg-panel px-3 py-2">
            <span className="w-10 shrink-0 text-sm font-bold text-foreground">{weekdayShort(night.startTime)}</span>
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{night.title}</p>
                <p className="text-xs text-muted">{timeRange(night.startTime, night.endTime)}{often}</p>
            </div>
            {night.isNext && <Pill tone="success">Next</Pill>}
        </li>
    );
}

export function GuildRaidSchedule({ schedule, kind }: { schedule: GuildScheduleNightDto[]; kind?: GuildKind | undefined }): JSX.Element {
    const copy = hubCopy(kind);
    return (
        <WidgetCard id="guild-raid-schedule" title={copy.scheduleTitle}>
            {schedule.length === 0
                ? <QuietEmpty>{copy.scheduleEmpty}</QuietEmpty>
                : <ul className="flex flex-col gap-2">{schedule.map((n) => <NightRow key={n.recurrenceGroupId} night={n} />)}</ul>}
            <CardFootnote>Shown in your local time</CardFootnote>
        </WidgetCard>
    );
}
