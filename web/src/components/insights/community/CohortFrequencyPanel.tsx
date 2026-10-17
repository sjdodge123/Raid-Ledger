import { useState } from 'react';
import type {
    CohortFrequencyBucketDto,
    CohortFrequencyEntryDto,
} from '@raid-ledger/contract';
import { useCohortGameFrequency, type CohortFrequencyMode } from '../../../hooks/use-community-insights';
import { InsightsPanelShell } from './InsightsPanelShell';

/** Rows rendered per cohort-size bucket. The API caps at the same N. */
const TOP_N = 5;

const EMPTY_COPY = 'No cohort data yet — needs decided lineups to populate.';

/**
 * ROK-1310 — "Most-matched games by group size".
 *
 * Appends below the ROK-1099 community panels and reuses their chrome
 * (`InsightsPanelShell`) and ranked-row shape (`ChurnRiskTable`). The endpoint
 * reads the live cohort-memory table, so an empty payload is a 200 — the empty
 * state here is the AC copy, NOT the shell's "run a refresh" no-snapshot hint.
 */
export function CohortFrequencyPanel() {
    const [mode, setMode] = useState<CohortFrequencyMode>('matched');
    const q = useCohortGameFrequency(mode);

    return (
        <InsightsPanelShell
            testid="community-insights-cohort-frequency"
            title="Most-matched games by group size"
            status={q}
            actions={<ModeToggle mode={mode} onChange={setMode} />}
        >
            {q.data && q.data.buckets.length === 0 && (
                <p className="text-sm text-muted">{EMPTY_COPY}</p>
            )}
            {q.data && q.data.buckets.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {q.data.buckets.map((bucket) => (
                        <BucketTable key={bucket.bucket} bucket={bucket} mode={mode} />
                    ))}
                </div>
            )}
        </InsightsPanelShell>
    );
}

function ModeToggle({
    mode,
    onChange,
}: {
    mode: CohortFrequencyMode;
    onChange: (m: CohortFrequencyMode) => void;
}) {
    return (
        <div className="flex rounded-md border border-edge overflow-hidden" role="group">
            <ModeButton label="Matched" value="matched" mode={mode} onChange={onChange} />
            <ModeButton label="Rejected" value="rejected" mode={mode} onChange={onChange} />
        </div>
    );
}

function ModeButton({
    label,
    value,
    mode,
    onChange,
}: {
    label: string;
    value: CohortFrequencyMode;
    mode: CohortFrequencyMode;
    onChange: (m: CohortFrequencyMode) => void;
}) {
    const active = mode === value;
    return (
        <button
            type="button"
            aria-pressed={active}
            onClick={() => onChange(value)}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                active ? 'bg-surface text-foreground' : 'bg-panel/50 text-muted hover:text-foreground'
            }`}
        >
            {label}
        </button>
    );
}

function BucketTable({ bucket, mode }: { bucket: CohortFrequencyBucketDto; mode: CohortFrequencyMode }) {
    const rows = bucket.entries.slice(0, TOP_N);
    return (
        <div data-testid={`cohort-bucket-${bucket.bucket}`}>
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-2">
                Groups of {bucket.bucket}
            </h3>
            <table className="min-w-full text-sm">
                <caption className="sr-only">
                    Top {TOP_N} {mode === 'rejected' ? 'rejected' : 'matched'} games for cohorts of{' '}
                    {bucket.bucket}
                </caption>
                <thead>
                    <tr className="text-left text-xs uppercase tracking-wider text-muted">
                        <th scope="col" className="py-2 pr-2">#</th>
                        <th scope="col" className="py-2 pr-4">Game</th>
                        <th scope="col" className="py-2 text-right">
                            {mode === 'rejected' ? 'Rejections' : 'Matches'}
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((entry) => (
                        <CohortRow key={entry.gameId} entry={entry} bucket={bucket.bucket} mode={mode} />
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function CohortRow({
    entry,
    bucket,
    mode,
}: {
    entry: CohortFrequencyEntryDto;
    bucket: string;
    mode: CohortFrequencyMode;
}) {
    return (
        <tr
            data-testid={`cohort-row-${bucket}-${entry.gameId}`}
            className="border-t border-edge/30 align-top"
        >
            <td className="py-2 pr-2 text-muted tabular-nums">{entry.rank}</td>
            <td className="py-2 pr-4">
                <div className="flex items-center gap-2">
                    <Cover url={entry.gameCoverUrl} name={entry.gameName} />
                    <div>
                        <span className="text-foreground">{entry.gameName}</span>
                        <BreakdownBadge entry={entry} mode={mode} />
                    </div>
                </div>
            </td>
            <td className="py-2 text-right text-foreground tabular-nums">{entry.count}</td>
        </tr>
    );
}

function Cover({ url, name }: { url: string | null; name: string }) {
    if (!url) {
        return <div className="w-8 h-10 rounded bg-overlay shrink-0" aria-hidden="true" />;
    }
    return (
        <img
            src={url}
            alt={`${name} cover`}
            loading="lazy"
            className="w-8 h-10 rounded object-cover shrink-0"
        />
    );
}

/**
 * In `matched` mode `vetoLost` is always 0, so only the three positive parts
 * are shown; in `rejected` mode the count IS `vetoLost` and a split would be
 * noise, so the badge collapses to a single label.
 */
function BreakdownBadge({ entry, mode }: { entry: CohortFrequencyEntryDto; mode: CohortFrequencyMode }) {
    const { decided, match, vetoWon, vetoLost } = entry.breakdown;
    const parts =
        mode === 'rejected'
            ? [`${vetoLost} vetoed out`]
            : [
                  decided > 0 ? `${decided} decided` : null,
                  match > 0 ? `${match} match` : null,
                  vetoWon > 0 ? `${vetoWon} veto survived` : null,
              ].filter((p): p is string => p !== null);

    if (parts.length === 0) return null;
    return (
        <span className="block text-xs text-muted" data-testid={`cohort-breakdown-${entry.gameId}`}>
            {parts.join(' · ')}
        </span>
    );
}
