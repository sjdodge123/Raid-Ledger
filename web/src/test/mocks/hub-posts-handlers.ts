/**
 * ROK-1868 — default hub-post handlers: an empty feed, a composer with a usable
 * `#news` channel, create echoing the body (400 `{body:[…]}` on `<script`),
 * patch, delete. Specs override with `server.use()`.
 */
import { http, HttpResponse } from 'msw';
import { buildHubPost, buildHubPostComposer } from '../factories/hub-posts';

const POSTS = 'http://localhost:3000/guilds/:id/posts';

interface CreateBody { body: string; relayToDiscord: boolean }

export const hubPostsHandlers = [
    http.get(POSTS, () => HttpResponse.json({ posts: [], nextCursor: null })),
    http.get(`${POSTS}/composer`, () => HttpResponse.json(buildHubPostComposer())),
    http.get(`${POSTS}/:postId`, ({ params }) =>
        HttpResponse.json(buildHubPost({ id: Number(params['postId']), guildId: Number(params['id']) }))),
    http.post(POSTS, async ({ request, params }) => {
        const input = (await request.json()) as CreateBody;
        if (input.body.includes('<script')) {
            return HttpResponse.json({ body: ["Posts can't contain HTML. Use the formatting buttons instead."] }, { status: 400 });
        }
        const post = buildHubPost({ id: 99, guildId: Number(params['id']), body: input.body });
        return HttpResponse.json({ post, relayOutcome: input.relayToDiscord ? 'sent' : 'not_requested' }, { status: 201 });
    }),
    http.patch(`${POSTS}/:postId`, async ({ request, params }) => {
        const input = (await request.json()) as { body: string };
        const editedBy = { userId: 1, displayName: 'Grimtusk', avatarUrl: null };
        return HttpResponse.json(buildHubPost({ id: Number(params['postId']), body: input.body, editedBy }));
    }),
    http.delete(`${POSTS}/:postId`, () => new HttpResponse(null, { status: 204 })),
];
