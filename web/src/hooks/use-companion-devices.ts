/**
 * ROK-1955 — the owner-only Companion Devices API: list, rename, remove.
 * Both mutations invalidate the list so a renamed / removed row re-renders
 * from the server's answer (a removed device stays listed as revoked).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { CompanionDeviceListResponseSchema, CompanionDeviceSchema } from '@raid-ledger/contract';
import type { CompanionDevice } from '@raid-ledger/contract';
import { fetchApi } from '../lib/api/fetch-api';

const DEVICES_PATH = '/companion/v1/devices';

/** Query key for the signed-in user's Companion devices. */
export const COMPANION_DEVICES_KEY = ['companion-devices'] as const;

/** Rename request: the device id and its new display name. */
export interface CompanionDeviceRename { id: number; name: string }

/** `GET /companion/v1/devices` → the device rows. */
export async function fetchCompanionDevices(): Promise<CompanionDevice[]> {
    const res = await fetchApi(DEVICES_PATH, {}, CompanionDeviceListResponseSchema);
    return res.data;
}

/** `PATCH /companion/v1/devices/:id` → the renamed device. */
export function renameCompanionDevice({ id, name }: CompanionDeviceRename): Promise<CompanionDevice> {
    const init = { method: 'PATCH', body: JSON.stringify({ name }) };
    return fetchApi(`${DEVICES_PATH}/${id}`, init, CompanionDeviceSchema);
}

/** `DELETE /companion/v1/devices/:id` (204) — the token stops working at once. */
export function revokeCompanionDevice(id: number): Promise<void> {
    return fetchApi<void>(`${DEVICES_PATH}/${id}`, { method: 'DELETE' });
}

/** The device list. */
export function useCompanionDevices(): UseQueryResult<CompanionDevice[], Error> {
    return useQuery({ queryKey: COMPANION_DEVICES_KEY, queryFn: fetchCompanionDevices });
}

/** Rename a device; refreshes the list on success. */
export function useRenameCompanionDevice(): UseMutationResult<CompanionDevice, Error, CompanionDeviceRename> {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: renameCompanionDevice,
        onSuccess: () => qc.invalidateQueries({ queryKey: COMPANION_DEVICES_KEY }),
    });
}

/** Remove (revoke) a device; refreshes the list on success. */
export function useRevokeCompanionDevice(): UseMutationResult<void, Error, number> {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: revokeCompanionDevice,
        onSuccess: () => qc.invalidateQueries({ queryKey: COMPANION_DEVICES_KEY }),
    });
}
