/**
 * "Share my download ETA with lineup rosters" (ROK-1374, operator ruling
 * 2026-09-05).
 *
 * Its OWN consent, default OFF, and deliberately not folded into the speed
 * test's: agreeing to measure your line is not agreeing to publish what it
 * means. What it shares is minutes on a readiness card — never the Mbps
 * figure, its source, or when it was taken (AC20).
 *
 * It cannot be turned on before there is something to share, and says so
 * rather than silently doing nothing.
 */
import type { JSX } from 'react';
import type { ConnectionSpeedDto } from '@raid-ledger/contract';
import { useSetDownloadEtaSharing } from '../../../hooks/use-connection-speed';

interface Props {
    speed: ConnectionSpeedDto | undefined;
}

/** The sharing switch, its one-line explanation, and its precondition. */
export function ShareEtaRow({ speed }: Props): JSX.Element {
    const share = useSetDownloadEtaSharing();
    const shared = !!speed?.shareEtaAt;
    const ready = !!speed?.consentAt && speed?.downstreamMbps !== null;
    return (
        <div className="rounded border border-edge bg-surface p-2">
            <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                    type="checkbox"
                    checked={shared}
                    disabled={!ready || share.isPending}
                    onChange={(e) => share.mutate({ share: e.target.checked })}
                    className="h-4 w-4"
                />
                Share my download ETA with lineup rosters
            </label>
            <p className="mt-1 text-xs text-muted">
                Others on a lineup roster see your estimated download time for the
                tied games — never your speed or how it was measured.
            </p>
            {!ready && (
                <p className="mt-1 text-xs text-muted">
                    Measure or enter a speed first
                </p>
            )}
        </div>
    );
}
