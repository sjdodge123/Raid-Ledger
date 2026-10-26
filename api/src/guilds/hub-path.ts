/**
 * The canonical web path of a hub page. `/hubs/<id>` is canonical since
 * ROK-1891; `/guilds/<id>` only redirects, so every link the API hands out
 * (notification payloads, Discord buttons, deep links, demo fixtures) goes
 * through here. API ROUTES are unaffected — `/guilds/:id/...` controllers stay.
 *
 * @param hubId - The hub's `guilds.id`.
 * @returns A root-relative path, e.g. `/hubs/7`.
 */
export function hubPath(hubId: number): string {
  return `/hubs/${hubId}`;
}
