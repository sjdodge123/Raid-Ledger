/**
 * ROK-2147 — MSW fixtures for `GET /plugins/wow/characters/:id/installed-addons`
 * and the guild addons list the character card matches against. Not
 * registered globally: specs install them with `server.use(...)`.
 */
import { http, HttpResponse } from 'msw';
import type { CharacterInstalledAddon, CharacterInstalledAddonsResponse, GuildAddon } from '@raid-ledger/contract';

const API = 'http://localhost:3000';

export const INSTALLED_ADDONS_URL = `${API}/plugins/wow/characters/:id/installed-addons`;

export const INSTALLED_CAPTURED_AT = '2026-11-01T12:00:00.000Z';

export function installedAddon(name: string, over: Partial<CharacterInstalledAddon> = {}): CharacterInstalledAddon {
    return { name, title: null, version: null, loaded: true, ...over };
}

/** Owner / officer view with an export on file. */
export function visibleInstalled(addons: CharacterInstalledAddon[]): CharacterInstalledAddonsResponse {
    return { visible: true, installed: { addons, capturedAt: INSTALLED_CAPTURED_AT } };
}

export const NOT_VISIBLE: CharacterInstalledAddonsResponse = { visible: false, installed: null };
export const VISIBLE_NO_EXPORT: CharacterInstalledAddonsResponse = { visible: true, installed: null };

/** Reply with `body`, or with a bare status (e.g. 403) when given a number. */
export function serveInstalledAddons(body: CharacterInstalledAddonsResponse | number) {
    return http.get(INSTALLED_ADDONS_URL, () => (
        typeof body === 'number' ? new HttpResponse(null, { status: body }) : HttpResponse.json(body)
    ));
}

export function guildAddonFixture(id: number, over: Partial<GuildAddon> = {}): GuildAddon {
    return {
        id, guildId: 11, source: 'curseforge', slugOrUrl: `addon-${id}`, url: `https://www.curseforge.com/wow/addons/addon-${id}`,
        displayName: `Addon ${id}`, note: null, requirement: 'optional', flavor: null, folderName: null, sortOrder: id,
        createdAt: '2026-11-07T00:00:00.000Z', updatedAt: '2026-11-07T00:00:00.000Z', ...over,
    };
}
