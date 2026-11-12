/**
 * ROK-2187 L10 — dry run, recompute and send-now for the admin GG panel.
 * Recompute is refused by the API after the announcement unless `force`.
 */
import type { JSX } from 'react';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { GgAdminDryRunDto } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { Checkbox } from '../../../components/ui/checkbox';
import { DiscardChangesConfirm } from '../../../components/ui/discard-changes-confirm';
import { useGgDryRun } from '../../../hooks/admin/use-gg-admin';
import { recomputeGg, sendGgNow } from '../../../lib/api/gg-admin-api';
import { toast } from '../../../lib/toast';

function DryRunTable({ r }: { r: GgAdminDryRunDto }): JSX.Element {
    const rows: [string, number][] = [
        ['Users computed', r.usersComputed], ['Short GG', r.short], ['Full GG', r.full], ['Would DM', r.wouldDm],
        ['Skipped · deactivated', r.skipped.deactivated], ['Skipped · opted out', r.skipped.optedOut],
        ['In-app only · no Discord', r.skipped.noDiscord], ['Skipped · no activity', r.skipped.noActivity],
    ];
    return (
        <div data-testid="gg-dry-run-result" className="space-y-2">
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
            {rows.map(([k, v]) => (
                <div key={k} className="bg-surface border border-edge rounded-lg p-2">
                    <dt className="text-xs text-muted">{k}</dt><dd className="text-foreground font-semibold">{v}</dd>
                </div>
            ))}
        </dl>
        {r.announcedAt && <p className="text-xs text-muted">Announced {new Date(r.announcedAt).toLocaleString()}</p>}
        </div>
    );
}

/** "Send now" behind a confirm: it posts the announcement and starts the DM wave. */
function SendNow({ year, wouldDm, pending, onSend }: { year: number; wouldDm: number | undefined; pending: boolean; onSend: () => void }): JSX.Element {
    const [confirming, setConfirming] = useState(false);
    const who = wouldDm === undefined ? 'players' : `${wouldDm} player${wouldDm === 1 ? '' : 's'}`;
    return (
        <>
            <Button variant="warning-soft" data-testid="gg-send-now" loading={pending} onClick={() => setConfirming(true)}>Send now</Button>
            <DiscardChangesConfirm isOpen={confirming} onKeep={() => setConfirming(false)}
                onDiscard={() => { setConfirming(false); onSend(); }}
                message={`Post the GG ${year} announcement and DM ${who} now? This can't be undone.`}
                copy={{ title: `Send GG ${year} now?`, keepLabel: 'Cancel', discardLabel: 'Send now' }} />
        </>
    );
}

/** Dry run / recompute / send now for the current year. */
export function GgAdminActions({ year }: { year: number }): JSX.Element {
    const [asked, setAsked] = useState(false);
    const [force, setForce] = useState(false);
    const dry = useGgDryRun(year, asked);
    const done = { onSuccess: () => { toast.success('Done'); void dry.refetch(); }, onError: (e: Error) => toast.error(e.message) };
    const recompute = useMutation({ mutationFn: () => recomputeGg(force ? { year, force } : { year }), ...done });
    const send = useMutation({ mutationFn: sendGgNow, ...done });
    return (
        <section data-testid="gg-admin-actions" className="bg-panel border border-edge rounded-lg p-4 space-y-3">
            <h3 className="text-base font-semibold text-foreground">GG {year} — check and send</h3>
            <div className="flex flex-wrap gap-2">
                <Button variant="secondary" data-testid="gg-dry-run" loading={dry.isFetching}
                    onClick={() => (asked ? void dry.refetch() : setAsked(true))}>Dry run</Button>
                <Button variant="secondary" data-testid="gg-recompute" loading={recompute.isPending} onClick={() => recompute.mutate()}>Recompute</Button>
                <SendNow year={year} wouldDm={dry.data?.wouldDm} pending={send.isPending} onSend={() => send.mutate()} />
            </div>
            <Checkbox checked={force} onChange={(e) => setForce(e.target.checked)} label="Force recompute after the announcement" />
            {dry.isError && <p role="alert" className="text-sm text-danger">{dry.error.message}</p>}
            {dry.data && <DryRunTable r={dry.data} />}
        </section>
    );
}
