/**
 * ROK-1428 (L7) — the Run section (spec §3.1 item 5): "Preview changes" (dry
 * run) and "Run now", which previews first and asks to confirm the counts in a
 * `Modal` at ≥1024px or a `BottomSheet` below (design-system §4.4).
 */
import { useState, type JSX } from 'react';
import type { ReconcileResultDto } from '@raid-ledger/contract';
import { BottomSheet } from '../../components/ui/bottom-sheet';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/modal';
import { useMediaQuery } from '../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../lib/breakpoints';
import { useReconcile } from '../../hooks/admin/use-channel-lifecycle';
import { confirmCopy, relativeTime, resultSummary, stopCopy } from './discord-lifecycle.helpers';

/** Confirm the planned counts before touching Discord. */
export function RunConfirm({ plan, running, onConfirm, onClose }: {
    plan: ReconcileResultDto; running: boolean; onConfirm: () => void; onClose: () => void;
}): JSX.Element {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const footer = (
        <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={onConfirm} loading={running}>Run in Discord</Button>
        </>
    );
    const shared = { isOpen: true, onClose, title: 'Run channel automation', footer };
    const body = <p className="text-sm text-foreground" data-testid="lifecycle-run-confirm">{confirmCopy(plan)}</p>;
    if (isDesktop) return <Modal {...shared}>{body}</Modal>;
    return <BottomSheet {...shared}>{body}</BottomSheet>;
}

/** Counts, a stop banner, and the per-game rows of one reconcile. */
export function ReconcileSummary({ result }: { result: ReconcileResultDto }): JSX.Element {
    const stop = stopCopy(result.stoppedReason);
    return (
        <div className="space-y-2" data-testid="lifecycle-run-result">
            {stop && <p role="alert" className="text-sm text-warning bg-warning/10 border border-warning/30 rounded-lg px-3 py-2">{stop}</p>}
            <p className="text-sm text-foreground">{resultSummary(result)}</p>
            {result.items.length > 0 && (
                <ul className="text-sm text-muted space-y-1">
                    {result.items.map((i) => (
                        <li key={`${i.gameId}-${i.action}`}>{i.gameName}: {i.action} — {i.outcome}{i.detail ? ` (${i.detail})` : ''}</li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function LastRunLine({ lastRunAt, lastRunError }: { lastRunAt: string | null; lastRunError: string | null }): JSX.Element {
    if (lastRunError) {
        return <p role="alert" className="text-sm text-danger bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">{lastRunError}</p>;
    }
    return <p className="text-sm text-muted">{lastRunAt ? `Last run ${relativeTime(lastRunAt)}` : 'Not run yet'}</p>;
}

function useRunFlow() {
    const reconcile = useReconcile();
    const [result, setResult] = useState<ReconcileResultDto | null>(null);
    const [confirming, setConfirming] = useState(false);
    const run = (dryRun: boolean, then?: () => void): void => {
        reconcile.mutate(dryRun, { onSuccess: (r) => { setResult(r); then?.(); } });
    };
    const preview = (): void => run(true);
    const runNow = (): void => run(true, () => setConfirming(true));
    const confirm = (): void => run(false, () => setConfirming(false));
    return { reconcile, result, confirming, setConfirming, preview, runNow, confirm };
}

/** Section 5 — the preview / run buttons, the last-run line and the latest result. */
export function RunSection({ lastRunAt, lastRunError }: { lastRunAt: string | null; lastRunError: string | null }): JSX.Element {
    const flow = useRunFlow();
    const busy = flow.reconcile.isPending;
    return (
        <section className="bg-surface rounded-xl border border-edge p-6 space-y-3" aria-label="Run">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-base font-semibold text-foreground">Run</h3>
                <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={flow.preview} disabled={busy}>Preview changes</Button>
                    <Button onClick={flow.runNow} disabled={busy}>Run now</Button>
                </div>
            </div>
            <LastRunLine lastRunAt={lastRunAt} lastRunError={lastRunError} />
            {flow.reconcile.error && <p role="alert" className="text-sm text-danger">{flow.reconcile.error.message}</p>}
            {flow.result && <ReconcileSummary result={flow.result} />}
            {flow.confirming && flow.result && (
                <RunConfirm plan={flow.result} running={busy} onConfirm={flow.confirm} onClose={() => flow.setConfirming(false)} />
            )}
        </section>
    );
}
