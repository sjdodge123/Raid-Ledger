import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { stripUnrecognizedKeys } from './schema-skew';

vi.mock('../../sentry', () => ({ Sentry: { addBreadcrumb: vi.fn() } }));
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
