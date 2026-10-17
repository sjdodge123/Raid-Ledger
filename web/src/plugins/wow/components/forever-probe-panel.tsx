/**
 * ROK-1716: the WoW Forever namespace probe panel inside the admin "WoW
 * Forever" section — last run + status, a found banner, the collapsed
 * candidate x region matrix, Run now, and the probe's own settings. It only
 * reports: flipping the prefix / Armory switch stays with the controls above.
 */
import type { JSX } from 'react';
import type { ForeverProbeResultDto } from '@raid-ledger/contract';
import { toast } from '../../../lib/toast';
import { Button } from '../../../components/ui/button';
import { TestResultBanner } from '../../../components/admin/admin-form-helpers';
import { useForeverProbe } from '../hooks/use-forever-probe';
import { ForeverProbeMatrix } from './forever-probe-matrix';
import { ForeverProbeConfigForm } from './forever-probe-config-form';

const STATUS_CLS: Record<ForeverProbeResultDto['status'], string> = {
    ok: 'text-success', skipped: 'text-warning', error: 'text-danger',
};

function LastRun({ result }: { result: ForeverProbeResultDto | null }): JSX.Element {
    if (!result) return <p className="text-sm text-muted">The probe has not run yet.</p>;
    const seconds = (result.durationMs / 1000).toFixed(1);
    return (
        <p className="text-sm text-secondary">
            Last run {new Date(result.ranAt).toLocaleString()} · <span className={`font-medium ${STATUS_CLS[result.status]}`}>{result.status}</span>
            {' '}· {result.cells.length} checks in {seconds}s
        </p>
    );
}

function FoundBanner({ result }: { result: ForeverProbeResultDto | null }): JSX.Element | null {
    if (!result?.found) return null;
    const message = `Forever namespace found: ${result.found.prefix} — set it above and enable Armory when ready.`;
    return <TestResultBanner result={{ success: true, message }} />;
}

/** Admin Forever namespace probe results + Run now; renders nothing until the state has loaded. */
export function ForeverProbePanel(): JSX.Element | null {
    const { probe, run, saveConfig } = useForeverProbe();
    if (probe.isError) return <p className="text-sm text-danger">Failed to load the Forever namespace probe.</p>;
    if (!probe.data) return null;
    const { result } = probe.data;
    const onRun = (): void => {
        run.mutate(undefined, { onError: (err) => toast.error(err.message || 'Forever namespace probe failed') });
    };
    return (
        <section aria-labelledby="wow-forever-probe-heading" className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h4 id="wow-forever-probe-heading" className="text-sm font-semibold text-foreground">Namespace probe</h4>
                    <LastRun result={result} />
                </div>
                <Button variant="secondary" loading={run.isPending} loadingLabel="Running probe..." onClick={onRun}>Run now</Button>
            </div>
            <FoundBanner result={result} />
            {result && <ForeverProbeMatrix result={result} />}
            <ForeverProbeConfigForm key={`${probe.data.extraCandidates.join(',')}|${probe.data.characterPath ?? ''}`}
                saved={probe.data} mutate={saveConfig.mutateAsync} pending={saveConfig.isPending} />
        </section>
    );
}
