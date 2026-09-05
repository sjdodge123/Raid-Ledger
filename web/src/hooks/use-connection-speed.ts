/**
 * React Query hooks for the viewer's private connection speed (ROK-1374).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ConnectionSpeedDto } from '@raid-ledger/contract';
import {
    getConnectionSpeed,
    setConnectionSpeed,
    setSpeedTestConsent,
} from '../lib/api/connection-speed-api';
import { TIE_READINESS_KEY } from './use-tie-readiness';
import { toast } from '../lib/toast';

export const CONNECTION_SPEED_KEY = ['connection-speed'] as const;

/** The viewer's stored figure. All-null when they have never measured. */
export function useConnectionSpeed(enabled = true) {
    return useQuery<ConnectionSpeedDto>({
        queryKey: [...CONNECTION_SPEED_KEY],
        queryFn: getConnectionSpeed,
        enabled,
        staleTime: 60_000,
    });
}

/** Invalidate the speed itself plus every download estimate derived from it. */
function useSpeedInvalidation() {
    const qc = useQueryClient();
    return (): void => {
        void qc.invalidateQueries({ queryKey: [...CONNECTION_SPEED_KEY] });
        void qc.invalidateQueries({ queryKey: [...TIE_READINESS_KEY] });
    };
}

/** Persist a measured or hand-entered downstream figure. */
export function useSetConnectionSpeed() {
    const invalidate = useSpeedInvalidation();
    return useMutation({
        mutationFn: setConnectionSpeed,
        onSuccess: invalidate,
        onError: (err: Error) => {
            toast.error(err.message || 'Could not save your connection speed');
        },
    });
}

/** Grant or revoke consent. Revoking also deletes the figure (AC21 / E19). */
export function useSpeedTestConsent() {
    const invalidate = useSpeedInvalidation();
    return useMutation({
        mutationFn: setSpeedTestConsent,
        onSuccess: invalidate,
        onError: (err: Error) => {
            toast.error(err.message || 'Could not update your consent');
        },
    });
}
