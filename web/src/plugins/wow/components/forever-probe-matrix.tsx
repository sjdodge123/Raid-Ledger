/**
 * ROK-1716: the Forever probe's candidate x region matrix. Each cell holds one
 * status chip per probed endpoint (realm, connected-realm, playable-race,
 * profile). Collapsed by default; the table scrolls inside its own container
 * so a phone never gets page overflow. Table styling follows the admin logs /
 * backups panels; chips follow the token-tint badge idiom.
 */
import type { JSX } from 'react';
import type { ForeverProbeCellDto, ForeverProbeEndpoint, ForeverProbeResultDto } from '@raid-ledger/contract';
import { ScrollCollapsible } from '../../../components/ui/scroll-collapsible';

const ENDPOINT_ORDER: readonly ForeverProbeEndpoint[] = ['realm', 'connected-realm', 'playable-race', 'profile'];
const REGION_ORDER: readonly string[] = ['us', 'eu', 'kr', 'tw'];
const TH = 'text-left px-3 py-2 text-xs font-semibold text-muted uppercase tracking-wider';
const TONE_CLS = {
    success: 'bg-success/10 border-success/30 text-success',
    warning: 'bg-warning/10 border-warning/30 text-warning',
    danger: 'bg-danger/10 border-danger/30 text-danger',
    muted: 'bg-panel border-edge text-muted',
} as const;

/** Chip tone for one probed status: 200 found, 403/404 expected refusal, null = network error. */
function probeStatusTone(status: number | null): keyof typeof TONE_CLS {
    if (status === null) return 'danger';
    if (status >= 200 && status < 300) return 'success';
    if (status === 403 || status === 404) return 'muted';
    return 'warning';
}

function regionsOf(cells: readonly ForeverProbeCellDto[]): string[] {
    const seen = new Set(cells.map((c) => c.region));
    const known = REGION_ORDER.filter((r) => seen.has(r));
    return [...known, ...[...seen].filter((r) => !REGION_ORDER.includes(r))];
}

function cellsFor(cells: readonly ForeverProbeCellDto[], prefix: string, region: string): ForeverProbeCellDto[] {
    return cells
        .filter((c) => c.prefix === prefix && c.region === region)
        .sort((a, b) => ENDPOINT_ORDER.indexOf(a.endpoint) - ENDPOINT_ORDER.indexOf(b.endpoint));
}

function StatusChip({ cell }: { cell: ForeverProbeCellDto }): JSX.Element {
    const label = cell.status === null ? 'err' : String(cell.status);
    const title = `${cell.endpoint}: ${cell.status ?? cell.error ?? 'error'}`;
    return (
        <span title={title} className={`inline-flex px-1.5 py-0.5 text-xs font-medium font-mono rounded-full border ${TONE_CLS[probeStatusTone(cell.status)]}`}>
            {label}
        </span>
    );
}

function MatrixRow({ prefix, regions, cells }: { prefix: string; regions: string[]; cells: readonly ForeverProbeCellDto[] }): JSX.Element {
    return (
        <tr>
            <th scope="row" className="px-3 py-2 text-left font-mono text-xs font-medium text-foreground whitespace-nowrap">{prefix}</th>
            {regions.map((region) => (
                <td key={region} className="px-3 py-2">
                    <div className="flex gap-1">
                        {cellsFor(cells, prefix, region).map((cell) => <StatusChip key={cell.endpoint} cell={cell} />)}
                    </div>
                </td>
            ))}
        </tr>
    );
}

/** The collapsed candidate x region status matrix for the latest probe run. */
export function ForeverProbeMatrix({ result }: { result: ForeverProbeResultDto }): JSX.Element {
    const regions = regionsOf(result.cells);
    return (
        <ScrollCollapsible title={`Probe matrix (${result.cells.length} checks)`} className="text-sm">
            <p className="mb-2 text-xs text-muted">Each cell: {ENDPOINT_ORDER.join(' · ')} status, in that order.</p>
            <div className="max-w-full overflow-x-auto border border-edge rounded-xl">
                <table className="min-w-max w-full text-sm">
                    <thead>
                        <tr className="border-b border-edge bg-surface/50">
                            <th scope="col" className={TH}>Candidate</th>
                            {regions.map((r) => <th key={r} scope="col" className={TH}>{r}</th>)}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-edge">
                        {result.candidates.map((p) => <MatrixRow key={p} prefix={p} regions={regions} cells={result.cells} />)}
                    </tbody>
                </table>
            </div>
        </ScrollCollapsible>
    );
}
