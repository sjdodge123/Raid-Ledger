/**
 * ROK-1717 / ROK-2163: the shared save path for the admin "WoW Forever"
 * settings — used by the always-visible switches and the DEMO_MODE-only
 * diagnostics (namespace prefix override).
 */
import type { WowForeverConfigResponseDto } from '@raid-ledger/contract';
import { toast } from '../../../lib/toast';
import type { useForeverConfig } from '../hooks/use-forever-config';

export type SaveFn = ReturnType<typeof useForeverConfig>['update']['mutateAsync'];
export type SaveDto = Parameters<SaveFn>[0];

/** The saved config as a PUT body, so one switch never resets another setting. */
export function savedDto(
    saved: WowForeverConfigResponseDto,
    patch: Partial<SaveDto>,
): SaveDto {
    const dto: SaveDto = {
        namespacePrefix: saved.namespacePrefix,
        armoryImportEnabled: saved.armoryImportEnabled,
        ...(saved.wowheadResolverEnabled !== undefined && {
            wowheadResolverEnabled: saved.wowheadResolverEnabled,
        }),
        ...(saved.questImportEnabled !== undefined && {
            questImportEnabled: saved.questImportEnabled,
        }),
        ...patch,
    };
    return dto;
}

export async function save(
    mutate: SaveFn,
    dto: SaveDto,
    success: string,
): Promise<void> {
    try {
        await mutate(dto);
        toast.success(success);
    } catch (err) {
        toast.error(
            err instanceof Error
                ? err.message
                : 'Failed to save WoW Forever settings',
        );
    }
}
