/**
 * The calendar's phone boundary (ROK-2303): below 768px the page opens in
 * Schedule, offers only Schedule / Month / Day, and keeps the Day view's
 * scroll across an event round-trip. Read this instead of repeating `< 768`.
 */
export const PHONE_CALENDAR_MAX_WIDTH = 767;

export function isPhoneCalendarWidth(width: number = window.innerWidth): boolean {
    return width <= PHONE_CALENDAR_MAX_WIDTH;
}
