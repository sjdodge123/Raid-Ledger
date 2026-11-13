/**
 * ROK-1789 — MSW fixtures for the WoW: Forever "Recruitment" card. The default
 * handler answers a member with nothing set (the card stays hidden), so hub
 * Overview specs that never look at it are unaffected. Specs `server.use()`
 * `guildRecruitmentGetHandler` with their own view.
 */
import { http, HttpResponse } from 'msw';
import type { GuildRecruitment, GuildRecruitmentView, GuildRecruitWanted } from '@raid-ledger/contract';
import { recruitmentHeadline } from '@raid-ledger/contract';

export const GUILD_RECRUITMENT_URL = 'http://localhost:3000/plugins/wow/guilds/:id/recruitment';
export const RECRUITMENT_UPDATED_AT = '2026-11-10T10:00:00.000Z';

/** The AC12 seed rows, deliberately out of state order (open, closed, limited, open). */
export const SEED_WANTED: GuildRecruitWanted[] = [
    { className: 'Priest', role: 'healer', state: 'open', note: 'Holy' },
    { className: 'Rogue', role: 'dps', state: 'closed' },
    { className: 'Druid', role: 'tank', state: 'limited', note: 'Exceptional only' },
    { className: 'Warlock', role: 'dps', state: 'open' },
];

export function buildRecruitment(over: Partial<GuildRecruitment> = {}): GuildRecruitment {
    return { recruiting: true, wanted: SEED_WANTED, applyUrl: 'https://example.com/apply', ...over };
}

/** A GET/PUT view; `state` is derived from the recruitment exactly as the server does. */
export function buildRecruitmentView(recruitment: GuildRecruitment | null, canEdit = false): GuildRecruitmentView {
    return {
        recruitment,
        state: recruitment === null ? null : recruitmentHeadline(recruitment),
        updatedAt: recruitment === null ? null : RECRUITMENT_UPDATED_AT,
        updatedBy: recruitment === null ? null : 'Thalia',
        viewer: { canEdit },
    };
}

/** GET → `body` (200), or the 403 a non-member gets. */
export function guildRecruitmentGetHandler(body: GuildRecruitmentView | 'forbidden') {
    return http.get(GUILD_RECRUITMENT_URL, () => (body === 'forbidden'
        ? HttpResponse.json({ statusCode: 403, message: 'Forbidden' }, { status: 403 })
        : HttpResponse.json(body)));
}

export const guildRecruitmentHandlers = [guildRecruitmentGetHandler(buildRecruitmentView(null))];
