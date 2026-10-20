/**
 * ROK-1868 wireframe — fake data only (DEV-ONLY). Nothing here talks to the API.
 * Shapes mirror the proposed `HubPost` contract (spec §1.1) so the mocks read
 * the same fields the real components will.
 */

export interface MockPerson {
    name: string;
}

export interface MockPost {
    id: number;
    body: string;
    author: MockPerson;
    posted: string;
    edited: { by: MockPerson; at: string } | null;
    relayedTo: string | null;
}

export const MOCK_GUILD = { id: 7, name: 'Hearthfire', channel: 'raid-news' } as const;

const LONG_BODY = [
    'Karazhan reclear moves to Thursday this week.',
    '',
    'Invites go out at 7:30 PM server time, first pull at 7:45. Bring flasks, food and repair gold — we are pushing for a full clear before the reset.',
    '',
    'Tanks: Bhaal and Mirelle. Healers, check the sheet in Resources for your assignments; I swapped two of you onto the Curator.',
    '',
    'If you can’t make it, mark yourself absent on the event so the bench knows.',
    '',
    'Thanks for a great week, everyone.',
].join('\n');

export const MOCK_POSTS: readonly MockPost[] = [
    {
        id: 31, body: LONG_BODY, author: { name: 'Thrall' }, posted: '18 Oct 2026',
        edited: { by: { name: 'Mirelle' }, at: '19 Oct 2026' }, relayedTo: MOCK_GUILD.channel,
    },
    {
        id: 27, body: 'New raid times start next week: Tue + Thu 8 PM. The calendar already shows them.',
        author: { name: 'Mirelle' }, posted: '11 Oct 2026', edited: null, relayedTo: MOCK_GUILD.channel,
    },
    {
        id: 19, body: 'Welcome to the new guild page! Rules and links live under Resources.',
        author: { name: 'Thrall' }, posted: '2 Oct 2026', edited: null, relayedTo: null,
    },
];

/** The deep link a post carries (spec A5): search param + the Posts tab hash. */
export function deepLink(postId: number): string {
    return `/guilds/${MOCK_GUILD.id}?post=${postId}#posts`;
}

/** The Discord excerpt: first ~300 chars on a word boundary (spec §2.5). */
export function excerpt(body: string, max = 300): string {
    if (body.length <= max) return body;
    const cut = body.slice(0, max - 1);
    const space = cut.lastIndexOf(' ');
    return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
