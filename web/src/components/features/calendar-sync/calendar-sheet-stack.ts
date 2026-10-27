/**
 * ROK-2022: the calendar sheets opened from inside another overlay. The
 * onboarding wizard is a full-screen dialog at `Z_INDEX.MODAL` (50), so a
 * `BottomSheet` (45) opened from its Calendar step would paint behind it. The
 * step provides `true`, and every calendar `BottomSheet` (Apple connect, the
 * Manage sheet, the disconnect confirm) passes it as `stacked` — the
 * documented ROK-1738 layer for a sheet opened inside an open Modal
 * (design-system §3, `BottomSheet`). Profile → Integrations keeps the default.
 */
import { createContext, useContext } from 'react';

export const CalendarSheetsStacked = createContext(false);

/** Whether the calendar sheets render on the stacked layer (inside the wizard). */
export function useCalendarSheetsStacked(): boolean {
    return useContext(CalendarSheetsStacked);
}
