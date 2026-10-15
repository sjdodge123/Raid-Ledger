/**
 * ROK-1786 — default guild page content handlers: no GM post, no rules or
 * links, no pinned or guild addons. Specs override with `server.use()`.
 */
import { http, HttpResponse } from 'msw';

const GUILDS = 'http://localhost:3000/plugins/wow/guilds';

export const guildContentHandlers = [
    http.get(`${GUILDS}/:id/profile`, ({ params }) =>
        HttpResponse.json({ guildId: Number(params.id), gmPost: null, rules: [], links: [] })),
    http.get(`${GUILDS}/:id/addons`, () => HttpResponse.json({ pinned: [], addons: [] })),
];
