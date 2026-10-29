/**
 * ROK-1930 / ROK-1943 — shared pieces of the Valheim Deaths + Map pin filter
 * smoke specs: the deaths fixture seed, the map/pin locators and the §4.1
 * Filters entry (toolbar funnel + inline panel ≥1024px, Filters FAB +
 * BottomSheet below — `web/src/components/ui/filter-entry.tsx`).
 *
 * Seed: `POST /admin/test/valheim/deaths-fixture { worker }` (DEMO_MODE) resets
 * THIS worker's own server hub to two characters with a map each on one world
 * (`valheim-deaths-demo-seed.data.ts`): `top` — Death "Day 12", Death "Day 31",
 * Fire "Camp" and a shared (cartography-table) Mine pin; `second` — Death
 * "Day 7" and Home "Copper". No pin is `checked`.
 */
import type { Locator, Page, Response } from "@playwright/test";
import { expect } from "./base";
import { API_BASE, apiPost, getAdminToken } from "./api-helpers";

const FIXTURE = "/admin/test/valheim/deaths-fixture";

export interface FixtureCharacter {
  id: number;
  name: string;
  mapId: number;
  deaths: number;
  deathPinLabels: string[];
}

export interface Fixture {
  serverId: number;
  guildId: number;
  worldUid: string;
  users: { member: { id: number }; visitor: { id: number } };
  characters: { top: FixtureCharacter; second: FixtureCharacter };
  unlinked: { name: string; deaths: number };
  /** ROK-1946: the world's scanned portals (raw tags, `""` = unnamed). */
  portals: { count: number; tags: string[] };
}

/** Install-or-activate through the admin plugin API (valheim-map-tab pattern). */
async function ensurePluginActive(
  token: string,
  pluginId: string,
): Promise<void> {
  const init = {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  };
  const install = await fetch(
    `${API_BASE}/admin/plugins/${pluginId}/install`,
    init,
  );
  if (install.ok) return;
  const activate = await fetch(
    `${API_BASE}/admin/plugins/${pluginId}/activate`,
    init,
  );
  if (!activate.ok)
    throw new Error(
      `failed to enable ${pluginId}: install ${install.status}, activate ${activate.status}`,
    );
}

/** Seeds this worker's deaths fixture (the slot is `testInfo.parallelIndex`). */
export async function seedDeathsFixture(worker: number): Promise<Fixture> {
  const token = await getAdminToken();
  await ensurePluginActive(token, "pelican");
  await ensurePluginActive(token, "valheim");
  const body = (await apiPost(token, FIXTURE, { worker })) as Partial<Fixture>;
  expect(
    body.guildId,
    `deaths fixture seed failed: ${JSON.stringify(body)}`,
  ).toEqual(expect.any(Number));
  return body as Fixture;
}

/** Resolves with the first response whose path ends with `suffix` (register BEFORE the action). */
export function responseTo(page: Page, suffix: string): Promise<Response> {
  return page.waitForResponse(
    (r) => new URL(r.url()).pathname.endsWith(suffix),
    { timeout: 15_000 },
  );
}

/** The ROK-1943 cross-player layer read: `GET …/servers/:id/pins`. */
export const serverPinsPath = (serverId: number): string =>
  `/servers/${serverId}/pins`;

export const mapApp = (page: Page): Locator =>
  page.getByRole("application", { name: "Valheim map" });
/**
 * Player/character pins: every button inside the map application except the
 * ROK-1946 scanned portals and the ROK-1859 chests (server data, their own
 * layers — `scannedPortals`; chests are `"<name> (Chest)"`).
 */
export const pins = (map: Locator): Locator =>
  map.getByRole("button", { name: /^(?!.*\((Scanned portal|Chest)\)$)/ });

/** ROK-1946 scanned portals: `"<tag | Unnamed portal> (Scanned portal)"`. */
export const scannedPortals = (map: Locator): Locator =>
  map.getByRole("button", { name: /\(Scanned portal\)$/ });

/** The pins' accessible names, sorted (order on the map is not meaningful). */
export async function pinNames(map: Locator): Promise<string[]> {
  const names = await pins(map).evaluateAll((els) =>
    els.map((e) => e.getAttribute("aria-label") ?? e.textContent ?? ""),
  );
  return names.map((n) => n.trim()).sort();
}

/** Opens the Filters entry and returns the scope holding its controls. */
export async function openFilters(page: Page, wide: boolean): Promise<Locator> {
  if (wide) {
    await page.getByTestId("filter-panel-trigger").click({ timeout: 15_000 });
    const panel = page.getByTestId("filter-panel");
    await expect(panel.getByTestId("map-pin-filter-panel")).toBeVisible();
    return panel;
  }
  await page.getByTestId("filter-fab").click({ timeout: 15_000 });
  const sheet = page.getByRole("dialog", { name: "Filters" });
  await expect(sheet.getByTestId("map-pin-filter-panel")).toBeVisible();
  return sheet;
}

/** Closes the phone sheet (the desktop panel may stay open: it is inline). */
export async function closeFilters(page: Page, wide: boolean): Promise<void> {
  if (wide) return;
  const sheet = page.getByRole("dialog", { name: "Filters" });
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();
}

/** A players-scope pin's accessible name (D14): `"<label> · <character> (<type>[, checked])"`. */
export const playerPinName = (
  label: string,
  character: string,
  type: string,
): string => `${label} · ${character} (${type})`;
