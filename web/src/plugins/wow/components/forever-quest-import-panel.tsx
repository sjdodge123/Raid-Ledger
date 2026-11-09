/**
 * ROK-2143: the WoW Forever classic quest import panel inside the admin "WoW
 * Forever" section, under the namespace probe and in its idiom — a heading,
 * a last-run line and a secondary button. A run is a background job: the
 * button starts it (202) and the report is polled while it says `running`.
 */
import type { JSX } from 'react';
import type { ForeverQuestImportReport, ForeverQuestImportStatus } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { useForeverQuestImport } from '../hooks/use-forever-quest-import';

const STATUS_CLS: Record<ForeverQuestImportStatus, string> = {
    idle: 'text-muted', running: 'text-warning', succeeded: 'text-success', failed: 'text-danger',
};

const when = (iso: string | null): string => (iso ? new Date(iso).toLocaleString() : 'an unknown time');

function StatusLine({ report }: { report: ForeverQuestImportReport }): JSX.Element {
    if (report.status === 'idle') return <p className="text-sm text-muted">The quest import has not run yet.</p>;
    const label = <span className={`font-medium ${STATUS_CLS[report.status]}`}>{report.status}</span>;
    if (report.status === 'running') {
        return <p className="text-sm text-secondary">Import {label} since {when(report.startedAt)}</p>;
    }
    return <p className="text-sm text-secondary">Last run {when(report.finishedAt)} · {label}</p>;
}

function Counts({ report }: { report: ForeverQuestImportReport }): JSX.Element | null {
    if (report.status === 'idle') return null;
    const { counts, errors } = report;
    return (
        <p className="text-sm text-secondary" data-testid="forever-quest-import-counts">
            {counts.areasImported} dungeons · {counts.questsFetched} quests · {counts.prerequisitesFetched} prerequisites
            {' '}· {counts.upserted} saved · {errors.length} {errors.length === 1 ? 'error' : 'errors'}
        </p>
    );
}

function MismatchedAreas({ report }: { report: ForeverQuestImportReport }): JSX.Element | null {
    if (report.mismatchedAreas.length === 0) return null;
    return (
        <div className="text-sm">
            <p className="font-medium text-warning">Skipped — Blizzard area name did not match:</p>
            <ul className="list-disc pl-5 text-secondary">
                {report.mismatchedAreas.map((a) => (
                    <li key={a.instanceId}>{a.dungeon} (area {a.areaId}: {a.actualName ?? 'not found'})</li>
                ))}
            </ul>
        </div>
    );
}

/** Admin Forever quest import status + Re-import; renders nothing until the report has loaded. */
export function ForeverQuestImportPanel(): JSX.Element | null {
    const { report, start } = useForeverQuestImport();
    if (report.isError) return <p className="text-sm text-danger">Failed to load the quest import status.</p>;
    if (!report.data) return null;
    const running = report.data.status === 'running';
    return (
        <section aria-labelledby="wow-forever-quest-import-heading" className="space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h4 id="wow-forever-quest-import-heading" className="text-sm font-semibold text-foreground">Dungeon quest data</h4>
                    <StatusLine report={report.data} />
                </div>
                <Button variant="secondary" loading={start.isPending || running} loadingLabel="Importing quests..."
                    onClick={() => start.mutate()}>Re-import quests</Button>
            </div>
            <Counts report={report.data} />
            <MismatchedAreas report={report.data} />
            {start.isError && <p role="alert" className="text-sm text-danger">{start.error.message}</p>}
        </section>
    );
}
