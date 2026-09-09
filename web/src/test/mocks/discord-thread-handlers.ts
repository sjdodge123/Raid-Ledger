/**
 * ROK-1483 — MSW handlers for the read-only Discord thread mirror.
 *
 * The default answers ONE message so a surface that incidentally mounts the
 * conversation panel resolves deterministically instead of tripping
 * `onUnhandledRequest: 'warn'`. Specs that assert on the thread override with
 * `server.use(threadMessagesHandler({ … }))`.
 */
import { http, HttpResponse, type HttpHandler } from 'msw';
import type {
    ThreadMessageDto,
    ThreadMessagesResponseDto,
} from '@raid-ledger/contract';

const API_BASE = 'http://localhost:3000';

/** `GET /discord/threads/:threadId/messages`. */
export const THREAD_MESSAGES_PATH = `${API_BASE}/discord/threads/:threadId/messages`;

/** One mirrored message, with every field the viewer reads populated. */
export function createMockThreadMessage(
    over: Partial<ThreadMessageDto> = {},
): ThreadMessageDto {
    return {
        messageId: '2000',
        author: {
            discordUserId: '900',
            displayName: 'Alice Bee',
            avatarUrl: null,
        },
        content: 'ready when you are',
        attachments: [],
        mentions: [],
        reactions: [],
        createdAt: new Date('2026-09-01T18:00:00.000Z').toISOString(),
        editedAt: null,
        ...over,
    };
}

/** A whole page, defaulted so a spec only states the field it cares about. */
export function createMockThreadPage(
    over: Partial<ThreadMessagesResponseDto> = {},
): ThreadMessagesResponseDto {
    return {
        threadId: 'T1',
        surface: { kind: 'lfg-group', id: '7' },
        messages: [createMockThreadMessage()],
        hasMore: false,
        threadUrl: 'https://discord.com/channels/1/T1',
        archived: false,
        ...over,
    };
}

/** Serves one fixed page for every request. */
export function threadMessagesHandler(
    over: Partial<ThreadMessagesResponseDto> = {},
) {
    return http.get(THREAD_MESSAGES_PATH, () =>
        HttpResponse.json(createMockThreadPage(over)),
    );
}

/**
 * Serves a NEWEST page and an OLDER page, switching on the `before` cursor,
 * and records every cursor it was sent — so "load older" can be asserted on
 * both the request the viewer made and the messages it then rendered.
 */
export function pagedThreadMessagesHandler(
    newest: Partial<ThreadMessagesResponseDto>,
    older: Partial<ThreadMessagesResponseDto>,
) {
    const cursors: (string | null)[] = [];
    const handler = http.get(THREAD_MESSAGES_PATH, ({ request }) => {
        const before = new URL(request.url).searchParams.get('before');
        cursors.push(before);
        return HttpResponse.json(
            createMockThreadPage(before === null ? newest : older),
        );
    });
    return { handler, cursors };
}

/** Registered globally in `handlers.ts`. */
export const discordThreadHandlers = [threadMessagesHandler()];

/**
 * Serves a SEQUENCE of newest pages (one per newest-page request, the last
 * repeating) plus a fixed older page, so a spec can prove that the thread the
 * viewer polls keeps moving while the reader is paged back.
 */
export function growingThreadMessagesHandler(
    newestPages: Partial<ThreadMessagesResponseDto>[],
    older: Partial<ThreadMessagesResponseDto>,
): HttpHandler {
    let served = 0;
    return http.get(THREAD_MESSAGES_PATH, ({ request }) => {
        const before = new URL(request.url).searchParams.get('before');
        if (before !== null)
            return HttpResponse.json(createMockThreadPage(older));
        const page = newestPages[Math.min(served, newestPages.length - 1)];
        served += 1;
        return HttpResponse.json(createMockThreadPage(page));
    });
}
