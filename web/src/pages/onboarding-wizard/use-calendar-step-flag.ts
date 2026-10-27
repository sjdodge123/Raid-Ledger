export interface CalendarStepFlag {
    needsCalendarConnect: boolean;
    settled: boolean;
}

/** STUB (red-first): replaced by the real flag in the next commit. */
export function useCalendarStepFlag(_resume: boolean): CalendarStepFlag {
    return { needsCalendarConnect: false, settled: true };
}
