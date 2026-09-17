/**
 * `?lock=<slotId>` deep link (ROK-1604 AC2): opens the EXISTING confirm for a
 * viewer allowed to lock an open poll's future slot, toasts otherwise, and
 * strips the param in every branch so a refresh never re-opens it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type {
    SchedulePollPageResponseDto,
    ScheduleSlotWithVotesDto,
} from '@raid-ledger/contract';

vi.mock('../../../../lib/toast', () => ({
    toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from '../../../../lib/toast';
import { useLockDeepLink } from '../use-lock-deep-link';

const CREATOR = { id: 1, role: 'member' };
const MEMBER = { id: 2, role: 'member' };
const FUTURE = '2035-06-10T20:00:00.000Z';
const PAST = '2020-01-01T00:00:00.000Z';

function slot(id: number, proposedTime = FUTURE): ScheduleSlotWithVotesDto {
    return { id, proposedTime, votes: [] } as unknown as ScheduleSlotWithVotesDto;
}

function poll(
    slots: ScheduleSlotWithVotesDto[],
    pollStatus: SchedulePollPageResponseDto['pollStatus'] = 'open',
): SchedulePollPageResponseDto {
    return {
        pollStatus,
        slots,
        match: { status: 'scheduling', lineupCreatedById: 1, members: [] },
    } as unknown as SchedulePollPageResponseDto;
}

type User = { id: number; role: string } | null;

type Props = { u: User; loading?: boolean };

function setup(
    p: SchedulePollPageResponseDto,
    user: User,
    search = '?lock=11',
    loading = false,
) {
    const requestLock = vi.fn().mockResolvedValue(undefined);
    const loc = { search: '' };
    const wrapper = ({ children }: { children: ReactNode }) => (
        <MemoryRouter initialEntries={[`/poll${search}&tab=x`]}>{children}</MemoryRouter>
    );
    const hook = renderHook(
        ({ u, loading: authLoading }: Props) => {
            useLockDeepLink({ poll: p, lock: { requestLock }, user: u, authLoading });
            loc.search = useLocation().search;
        },
        { wrapper, initialProps: { u: user, loading } as Props },
    );
    return { requestLock, loc, hook };
}

describe('useLockDeepLink', () => {
    beforeEach(() => vi.clearAllMocks());

    it('creator + open poll + future slot → opens that slot\'s confirm', () => {
        const target = slot(11);
        const { requestLock, loc } = setup(poll([slot(10), target]), CREATOR);
        expect(requestLock).toHaveBeenCalledWith(target, { forceConfirm: true });
        expect(toast.error).not.toHaveBeenCalled();
        expect(loc.search).toBe('?tab=x');
    });

    it('admin who is not the creator may lock', () => {
        const { requestLock } = setup(poll([slot(11)]), { id: 9, role: 'admin' });
        expect(requestLock).toHaveBeenCalledTimes(1);
    });

    it('member who cannot lock → toast, no confirm, param removed', () => {
        const { requestLock, loc } = setup(poll([slot(11)]), MEMBER);
        expect(requestLock).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledWith("You can't lock in this poll");
        expect(loc.search).toBe('?tab=x');
    });

    it('locked-in poll → ignored with a toast, param removed', () => {
        const { requestLock, loc } = setup(poll([slot(11)], 'locked_in'), CREATOR);
        expect(requestLock).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledWith("You can't lock in this poll");
        expect(loc.search).toBe('?tab=x');
    });

    it('past slot → "That time has passed", param removed', () => {
        const { requestLock, loc } = setup(poll([slot(11, PAST)]), CREATOR);
        expect(requestLock).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledWith('That time has passed');
        expect(loc.search).toBe('?tab=x');
    });

    it('unknown slot id → poll-changed toast, param removed', () => {
        const { requestLock, loc } = setup(poll([slot(10)]), CREATOR);
        expect(requestLock).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledWith(
            'This poll changed — refresh to see the latest',
        );
        expect(loc.search).toBe('?tab=x');
    });

    it('no param → does nothing', () => {
        const { requestLock } = setup(poll([slot(11)]), CREATOR, '?a=1');
        expect(requestLock).not.toHaveBeenCalled();
        expect(toast.error).not.toHaveBeenCalled();
    });

    it('waits for auth: loading does not consume the param', () => {
        const { requestLock, loc, hook } = setup(poll([slot(11)]), null, '?lock=11', true);
        expect(requestLock).not.toHaveBeenCalled();
        expect(toast.error).not.toHaveBeenCalled();
        expect(loc.search).toContain('lock=11');
        hook.rerender({ u: CREATOR, loading: false });
        expect(requestLock).toHaveBeenCalledTimes(1);
    });

    it('signed-out viewer → "can\'t lock" toast', () => {
        const { requestLock } = setup(poll([slot(11)]), null);
        expect(requestLock).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledWith("You can't lock in this poll");
    });

    it('re-render does not re-open the confirm', () => {
        const { requestLock, hook } = setup(poll([slot(11)]), CREATOR);
        hook.rerender({ u: CREATOR });
        hook.rerender({ u: { ...CREATOR } });
        expect(requestLock).toHaveBeenCalledTimes(1);
    });
});
