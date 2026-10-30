/**
 * `/claim` (ROK-1701) — claim this Raid Ledger with the host's setup code.
 * Public route; ClaimGate sends every other path here while
 * `status.claimRequired`. No stepper and no relay disclosure yet (spec D-8, OQ-8c).
 */
import { useState, type JSX } from 'react';
import { useSystemStatus } from '../../hooks/use-system-status';
import { ClaimForm } from './claim-form';
import { ClaimHostHelp } from './claim-host-help';
import { hoursLeft, isClaimExpired } from './claim.helpers';

function Footnote({ expiresAt, now }: { expiresAt: string | undefined; now: number }): JSX.Element {
    const left = expiresAt ? ` (${hoursLeft(expiresAt, now)} hours left)` : '';
    return (
        <p className="text-xs text-muted" data-testid="claim-footnote">
            The code stops working 72 hours after the first start{left}. Expired? Restart the service and a fresh
            code appears in its logs. Locked out later? Set <code className="font-mono">RESET_PASSWORD=true</code> on
            your host and restart.
        </p>
    );
}

/** The claim screen: intro, form, footnote, "Where's my code?". */
export function ClaimPage(): JSX.Element {
    const { data } = useSystemStatus();
    const expiresAt = data?.claimExpiresAt;
    const [now] = useState(() => Date.now());
    return (
        <div className="mx-auto w-full max-w-[560px] px-4 py-8">
            <p className="mb-3 text-right text-xs text-muted">First-time setup</p>
            <div className="flex flex-col gap-[18px] rounded-xl border border-edge bg-surface p-5 sm:p-8" data-testid="claim-card">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Claim this Raid Ledger</h1>
                    <p className="mt-2 text-sm text-secondary">
                        This server is brand new and has no owner yet. Enter the setup code your host made for you and
                        choose your admin password. The code works once.
                    </p>
                </div>
                <ClaimForm expiredOnLoad={isClaimExpired(expiresAt, now)} />
                <Footnote expiresAt={expiresAt} now={now} />
                <ClaimHostHelp />
            </div>
        </div>
    );
}
