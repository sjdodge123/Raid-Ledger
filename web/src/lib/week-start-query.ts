/**
 * Query serialisation for the DATED availability aggregate (ROK-1570).
 *
 * Lives in `lib/` rather than next to the grid helpers because the API client
 * (`lib/api/scheduling-api.ts`) is the primary caller, and `lib -> components`
 * is a direction this tree does not otherwise take in production code.
 * `getWeekStart` stays with the grid — it is view state, not query state.
 */

/**
 * Serialise a rendered week for the `?weekStart=` availability query.
 *
 * The grid's `weekStart` is LOCAL Sunday 00:00. The server normalises whatever
 * instant it receives to Sunday 00:00 **UTC** of that instant's UTC week, so
 * sending `weekStart.toISOString()` from any zone east of UTC (local Sunday
 * 00:00 = Saturday evening Z) would ask for the PREVIOUS week while the grid
 * paints this one. Send the calendar date at 00:00Z instead.
 */
export function weekStartQueryValue(weekStart: Date): string {
  return new Date(
    Date.UTC(
      weekStart.getFullYear(),
      weekStart.getMonth(),
      weekStart.getDate(),
    ),
  ).toISOString();
}

/**
 * The viewer's UTC offset for the DISPLAYED week, in browser convention
 * (`Date.getTimezoneOffset()`: minutes to ADD to local time to reach UTC, so
 * UTC-6 is +360). The server keys members' busy hours with it, matching
 * `GET /users/me/game-time?tzOffset=`; absent means 0, i.e. UTC keying.
 *
 * It is read off the week's Sunday, not off `new Date()`, because a DST
 * transition between today and the week being painted changes the offset — a
 * grid paged across the transition would otherwise key its busy hours an hour
 * out for the whole week.
 */
export function weekTzOffsetMinutes(weekStart: Date): number {
  return weekStart.getTimezoneOffset();
}
