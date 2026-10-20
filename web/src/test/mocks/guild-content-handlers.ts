/**
 * ROK-1786 — default guild page content handlers: no GM post, no rules or
 * links, no pinned or guild addons. Specs override with `server.use()`.
 */
import { http, HttpResponse } from 'msw';

const GUILDS = 'http://localhost:3000/plugins/wow/guilds';
/** Core hub routes (ROK-1831) — the profile moved off the WoW alias; addons stay WoW-owned. */
const CORE = 'http://localhost:3000/guilds';

export const guildContentHandlers = [
    http.get(`${CORE}/:id/profile`, ({ params }) =>
        HttpResponse.json({ guildId: Number(params.id), gmPost: null, latestPost: null, rules: [], links: [] })),
    http.get(`${GUILDS}/:id/addons`, () => HttpResponse.json({ pinned: [], addons: [] })),
];
