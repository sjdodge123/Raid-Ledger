import type { SystemStatusDto } from '@raid-ledger/contract';
import { useSystemStatus } from './use-system-status';

/** ROK-1700: the runtime flavour the api runs as (`RL_FLAVOUR`). */
export type RuntimeFlavour = NonNullable<SystemStatusDto['flavour']>;

/**
 * Resolve the flavour from a `/system/status` payload. A missing payload or
 * field (older api, status still loading or failed) means `nas`, so a NAS
 * install never loses a surface because the status call was slow.
 */
export function resolveFlavour(status: Pick<SystemStatusDto, 'flavour'> | undefined): RuntimeFlavour {
    return status?.flavour ?? 'nas';
}

/** The runtime flavour, from the shared `/system/status` query. */
export function useFlavour(): RuntimeFlavour {
    const { data } = useSystemStatus();
    return resolveFlavour(data);
}

/** True only when the api says it runs as the cloud flavour. */
export function useIsCloudFlavour(): boolean {
    return useFlavour() === 'cloud';
}

/**
 * The flavour once `/system/status` has settled — `undefined` while it is
 * still in flight (an error settles as nas). For callers that must not act
 * on the nas default before the api has answered, e.g. a fetch that 404s
 * under cloud. The boot path seeds this query, so in the app it is settled
 * from the first render.
 */
export function useSettledFlavour(): RuntimeFlavour | undefined {
    const { data, isPending } = useSystemStatus();
    if (isPending) return undefined;
    return resolveFlavour(data);
}
