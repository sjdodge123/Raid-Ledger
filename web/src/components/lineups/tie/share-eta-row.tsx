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
import { useId, type JSX } from 'react';
import type { ConnectionSpeedDto } from '@raid-ledger/contract';
import { useSetDownloadEtaSharing } from '../../../hooks/use-connection-speed';
import { Checkbox } from '../../ui/checkbox';

interface Props {
    speed: ConnectionSpeedDto | undefined;
}

/**
 * The sharing checkbox (ruling 12: a Checkbox, not a Switch), its one-line
 * explanation as its description, and — while it cannot be turned on — why.
 */
export function ShareEtaRow({ speed }: Props): JSX.Element {
    const share = useSetDownloadEtaSharing();
    const whyId = useId();
    const shared = !!speed?.shareEtaAt;
    const ready = !!speed?.consentAt && speed?.downstreamMbps !== null;
    return (
        <div className="rounded border border-edge bg-surface px-2">
            <Checkbox
                label="Share my download ETA with lineup rosters"
                description="Others on a lineup roster see your estimated download time for the tied games — never your speed or how it was measured."
                checked={shared}
                disabled={!ready || share.isPending}
                aria-describedby={ready ? undefined : whyId}
                onChange={(e) => share.mutate({ share: e.target.checked })}
            />
            {!ready && (
                <p id={whyId} className="pb-2 text-xs text-muted">
                    Measure or enter a speed first
                </p>
            )}
        </div>
    );
}
