/**
 * ROK-1716: the Forever probe's candidate x region matrix. Each cell holds one
 * status chip per probed endpoint (realm, connected-realm, playable-race,
 * profile, ROK-2102's ruleset / profile-family / guild-roster, and ROK-2103's
 * static journal tiers / instances / classes, ROK-2108's keys-only profile
 * extras / guild summary / ruleset detail), labelled
 * short in the legend. Matches are listed above the matrix: a ruleset-index
 * signal reads "ruleset index", a Skyborne one its race name. Collapsed by default; the table scrolls inside its own container
 * so a phone never gets page overflow. Table styling follows the admin logs /
 * backups panels; chips follow the token-tint badge idiom.
 */
import type { JSX } from 'react';
import type { ForeverProbeCellDto, ForeverProbeEndpoint, ForeverProbeMatchDto, ForeverProbeResultDto } from '@raid-ledger/contract';
import { ScrollCollapsible } from '../../../components/ui/scroll-collapsible';

const ENDPOINT_ORDER: readonly ForeverProbeEndpoint[] = [
    'realm', 'connected-realm', 'playable-race', 'ruleset', 'profile',
    'profile-equipment', 'profile-professions', 'profile-quests', 'profile-media', 'guild-roster',
    'journal-expansion', 'journal-instance', 'playable-class',
    'ruleset-detail', 'profile-specializations', 'profile-encounters-raids', 'profile-encounters-dungeons',
    'profile-reputations', 'profile-achievements', 'profile-statistics', 'profile-quests-completed', 'guild-summary',
];
/** Legend label per endpoint — the ROK-2102 additions get short names so the legend stays one line. */
const ENDPOINT_LABEL: Record<ForeverProbeEndpoint, string> = {
    realm: 'realm', 'connected-realm': 'connected-realm', 'playable-race': 'playable-race', ruleset: 'ruleset',
    profile: 'profile', 'profile-equipment': 'equip', 'profile-professions': 'prof', 'profile-quests': 'quests',
    'profile-media': 'media', 'guild-roster': 'guild',
    'journal-expansion': 'tiers', 'journal-instance': 'instances', 'playable-class': 'classes',
    // ROK-2108: keys-only profile sub-resources, guild summary and ruleset detail.
    'ruleset-detail': 'ruleset detail', 'profile-specializations': 'specs', 'profile-encounters-raids': 'raids',
    'profile-encounters-dungeons': 'dungeons', 'profile-reputations': 'reps', 'profile-achievements': 'achievements',
    'profile-statistics': 'stats', 'profile-quests-completed': 'quests done', 'guild-summary': 'guild summary',
};
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

/** What made a cell a match: the ruleset index, or the Skyborne race's name. */
function matchSignalLabel(match: ForeverProbeMatchDto): string {
    if (match.signal === 'ruleset') return 'ruleset index';
    return match.raceName ?? 'Skyborne race';
}

function MatchList({ matches }: { matches: readonly ForeverProbeMatchDto[] }): JSX.Element | null {
    if (matches.length === 0) return null;
    return (
        <ul aria-label="Probe matches" className="text-xs text-secondary space-y-0.5">
            {matches.map((m) => (
                <li key={`${m.prefix}:${m.region}:${m.signal}`} className="font-mono">{`${m.prefix}/${m.region}: ${matchSignalLabel(m)}`}</li>
            ))}
        </ul>
    );
}

function MatrixTable({ result, regions }: { result: ForeverProbeResultDto; regions: string[] }): JSX.Element {
    return (
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
    );
}

/** The match list plus the collapsed candidate x region status matrix for the latest probe run. */
export function ForeverProbeMatrix({ result }: { result: ForeverProbeResultDto }): JSX.Element {
    const regions = regionsOf(result.cells);
    const probed = ENDPOINT_ORDER.filter((e) => result.cells.some((c) => c.endpoint === e)).map((e) => ENDPOINT_LABEL[e]);
    return (
        <>
            <MatchList matches={result.matches} />
            <ScrollCollapsible title={`Probe matrix (${result.cells.length} checks)`} className="text-sm">
                <p className="mb-2 text-xs text-muted">Each cell: {probed.join(' · ')} status, in that order.</p>
                <MatrixTable result={result} regions={regions} />
            </ScrollCollapsible>
        </>
    );
}
