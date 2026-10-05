import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../../../../test/mocks/server';
import { createTestQueryClient } from '../../../../test/render-helpers';
import { AddonImportRequestError, useAddonImportApply, useAddonImportPreview } from './use-addon-import';
import { CHARACTER_ID, CHAR_STRING, IMPORT_URL, charResult } from './addon-import.test-fixtures';

function setup() {
    const queryClient = createTestQueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    return { wrapper, invalidate };
}

function captureBodies(status = 200, reply: Record<string, unknown> = charResult()) {
    const bodies: unknown[] = [];
    server.use(http.post(IMPORT_URL, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(reply, { status });
    }));
    return bodies;
}

describe('useAddonImportPreview', () => {
    it('posts dryRun:true and does not invalidate', async () => {
        const bodies = captureBodies();
        const { wrapper, invalidate } = setup();
        const { result } = renderHook(() => useAddonImportPreview(CHARACTER_ID), { wrapper });
        result.current.mutate({ importString: CHAR_STRING, confirm: { updateRuleset: true } });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(bodies).toEqual([{ importString: CHAR_STRING, dryRun: true, confirm: { updateRuleset: true } }]);
        expect(result.current.data?.section).toBe('char');
        expect(invalidate).not.toHaveBeenCalled();
    });

    it('keeps the error code and Add Character prefill from the body', async () => {
        const addCharacter = { firstName: 'Ana', secondName: 'Forever', region: 'us', ruleset: null, class: 'Paladin' };
        captureBodies(422, { code: 'NAME_MISMATCH', message: 'different', addCharacter });
        const { wrapper } = setup();
        const { result } = renderHook(() => useAddonImportPreview(CHARACTER_ID), { wrapper });
        result.current.mutate({ importString: CHAR_STRING });
        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.error).toBeInstanceOf(AddonImportRequestError);
        expect(result.current.error).toMatchObject({ status: 422, code: 'NAME_MISMATCH', addCharacter });
    });

    it('maps an off-contract error body to code null', async () => {
        captureBodies(500, { statusCode: 500, message: 'Internal server error' });
        const { wrapper } = setup();
        const { result } = renderHook(() => useAddonImportPreview(CHARACTER_ID), { wrapper });
        result.current.mutate({ importString: CHAR_STRING });
        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.error).toMatchObject({ status: 500, code: null });
    });
});

describe('useAddonImportApply', () => {
    it('posts dryRun:false and invalidates the character query on success', async () => {
        const bodies = captureBodies(201, charResult({ status: 'applied' }));
        const { wrapper, invalidate } = setup();
        const { result } = renderHook(() => useAddonImportApply(CHARACTER_ID), { wrapper });
        result.current.mutate({ importString: CHAR_STRING, confirm: { repinGuid: true } });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(bodies).toEqual([{ importString: CHAR_STRING, dryRun: false, confirm: { repinGuid: true } }]);
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ['characters', CHARACTER_ID] });
    });

    it('does not invalidate when the apply fails', async () => {
        captureBodies(429, { code: 'RATE_LIMITED', message: 'slow down' });
        const { wrapper, invalidate } = setup();
        const { result } = renderHook(() => useAddonImportApply(CHARACTER_ID), { wrapper });
        result.current.mutate({ importString: CHAR_STRING });
        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.error?.code).toBe('RATE_LIMITED');
        expect(invalidate).not.toHaveBeenCalled();
    });
});
