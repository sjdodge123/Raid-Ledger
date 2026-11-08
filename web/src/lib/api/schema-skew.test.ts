import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { toast } from 'sonner';
import { Sentry } from '../../sentry';
import {
    reportVersionSkew,
    resetVersionSkewNoticeForTests,
    stripUnrecognizedKeys,
} from './schema-skew';

vi.mock('../../sentry', () => ({ Sentry: { addBreadcrumb: vi.fn(), captureMessage: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { info: vi.fn() } }));

const RowSchema = z.object({ id: z.number(), name: z.string() }).strict();
const ListSchema = z.object({ data: z.array(RowSchema) }).strict();

function issuesOf(schema: z.ZodType, data: unknown): z.core.$ZodIssue[] {
    const result = schema.safeParse(data);
    return result.success ? [] : result.error.issues;
}

describe('stripUnrecognizedKeys (ROK-2116)', () => {
    it('drops unknown keys inside array elements and leaves the input untouched', () => {
        const input = { data: [{ id: 1, name: 'a', avatar: 'x' }, { id: 2, name: 'b' }], total: 2 };
        const stripped = stripUnrecognizedKeys(input, issuesOf(ListSchema, input));
        expect(stripped).toEqual({ data: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }] });
        expect(ListSchema.safeParse(stripped).success).toBe(true);
        expect(input.total).toBe(2);
    });

    it('returns null when any issue is a real shape error', () => {
        const input = { data: [{ id: '1', name: 'a', avatar: 'x' }] };
        expect(stripUnrecognizedKeys(input, issuesOf(ListSchema, input))).toBeNull();
    });

    it('returns null when there are no issues to explain', () => {
        expect(stripUnrecognizedKeys({}, [])).toBeNull();
    });
});

const CrestSchema = z.object({ kind: z.literal('crest'), url: z.string() }).strict();
const BannerSchema = z.object({ kind: z.literal('banner'), color: z.string() }).strict();

/** Strip, then re-parse with the full schema — the same two steps fetchApi takes. */
function recover(schema: z.ZodType, input: unknown): unknown {
    const stripped = stripUnrecognizedKeys(input, issuesOf(schema, input));
    if (stripped === null) return null;
    const retry = schema.safeParse(stripped);
    return retry.success ? retry.data : null;
}

describe('stripUnrecognizedKeys — union shapes (ROK-2116 review r1)', () => {
    it('recovers a discriminatedUnion of strict objects', () => {
        const schema = z.discriminatedUnion('kind', [CrestSchema, BannerSchema]);
        expect(recover(schema, { kind: 'banner', color: 'red', glow: true })).toEqual({
            kind: 'banner',
            color: 'red',
        });
    });

    it('recovers a plain union when only one branch fails solely on unknown keys', () => {
        const schema = z.union([CrestSchema, BannerSchema]);
        expect(recover(schema, { kind: 'crest', url: 'x.png', glow: true })).toEqual({
            kind: 'crest',
            url: 'x.png',
        });
    });
});

describe('reportVersionSkew (ROK-2116 review r1)', () => {
    beforeEach(() => {
        vi.mocked(Sentry.addBreadcrumb).mockClear();
        vi.mocked(Sentry.captureMessage).mockClear();
        vi.mocked(toast.info).mockClear();
        resetVersionSkewNoticeForTests();
    });

    it('breadcrumbs every call but toasts and captures a warning once per page load', () => {
        const input = { data: [{ id: 1, name: 'a', avatar: 'x' }, { id: 2, name: 'b', avatar: 'y' }] };
        const issues = issuesOf(ListSchema, input);
        reportVersionSkew('/rows', issues);
        reportVersionSkew('/rows', issues);
        expect(Sentry.addBreadcrumb).toHaveBeenCalledTimes(2);
        expect(toast.info).toHaveBeenCalledTimes(1);
        expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
        expect(Sentry.captureMessage).toHaveBeenCalledWith(
            'Response carried fields this bundle does not know',
            { level: 'warning', extra: { endpoint: '/rows', keys: ['data[].avatar'] } },
        );
    });
});
