import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { toast } from '../../../../lib/toast';
import { useImportCreated } from './use-import-created';
import { CREATED_ID, newCharResult } from './addon-import.test-fixtures';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-router-dom')>()),
    useNavigate: () => navigate,
}));
vi.mock('../../../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

describe('useImportCreated (ROK-1738 D10)', () => {
    beforeEach(() => { navigate.mockClear(); vi.mocked(toast.success).mockClear(); });

    it.each(['create', 'update'] as const)('after a %s: closes Add Character, toasts, and lands on the character page', (action) => {
        const onClose = vi.fn();
        const { result } = renderHook(() => useImportCreated(onClose));
        result.current(newCharResult({ action, characterId: CREATED_ID }, { status: 'applied' }));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(toast.success).toHaveBeenCalledTimes(1);
        expect(navigate).toHaveBeenCalledWith(`/characters/${CREATED_ID}`);
    });

    it('does not navigate without a character id', () => {
        const { result } = renderHook(() => useImportCreated(vi.fn()));
        result.current(newCharResult({ characterId: null }));
        expect(navigate).not.toHaveBeenCalled();
    });
});
