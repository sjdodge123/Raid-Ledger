import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@sentry/react', () => ({
    init: vi.fn(),
    browserTracingIntegration: vi.fn(() => 'browserTracingIntegration'),
    replayIntegration: vi.fn(() => 'replayIntegration'),
    makeFetchTransport: vi.fn(() => ({
        send: vi.fn(),
        flush: vi.fn(() => Promise.resolve(true)),
    })),
    captureMessage: vi.fn(),
    flush: vi.fn(() => Promise.resolve(true)),
}));

type SentryEvent = {
    exception?: { values?: { type?: string; value?: string }[] };
};
type BeforeSend = (event: SentryEvent) => SentryEvent | null;

describe('web Sentry beforeSend (ROK-1162)', () => {
    let beforeSend: BeforeSend;

    beforeEach(async () => {
        vi.resetModules();
        const Sentry = await import('@sentry/react');
        const initMock = Sentry.init as unknown as ReturnType<typeof vi.fn>;
        initMock.mockClear();
        await import('./sentry');
        const config = initMock.mock.calls[0][0] as { beforeSend: BeforeSend };
        beforeSend = config.beforeSend;
    });

    it('drops AbortError typed events', () => {
        const result = beforeSend({
            exception: {
                values: [{ type: 'AbortError', value: 'The operation was aborted' }],
            },
        });
        expect(result).toBeNull();
    });

    it('drops DOMException whose value mentions abort', () => {
        const result = beforeSend({
            exception: {
                values: [
                    {
                        type: 'DOMException',
                        value: 'The user aborted a request.',
                    },
                ],
            },
        });
        expect(result).toBeNull();
    });

    it('does NOT drop unrelated DOMException events', () => {
        const event: SentryEvent = {
            exception: {
                values: [{ type: 'DOMException', value: 'QuotaExceededError' }],
            },
        };
        expect(beforeSend(event)).toBe(event);
    });

    it('passes through unrelated TypeErrors', () => {
        const event: SentryEvent = {
            exception: {
                values: [
                    {
                        type: 'TypeError',
                        value: "Cannot read property 'x' of undefined",
                    },
                ],
            },
        };
        expect(beforeSend(event)).toBe(event);
    });

    it('passes through events without an exception payload', () => {
        const event: SentryEvent = {};
        expect(beforeSend(event)).toBe(event);
    });
});
