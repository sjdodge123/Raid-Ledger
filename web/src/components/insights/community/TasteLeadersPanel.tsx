import type { TasteLeaderDto } from '@raid-ledger/contract';

interface Props {
    leaders: TasteLeaderDto[];
}

/**
 * Top-5 taste leaders (betweenness or degree fallback). Each row shows
 * the driving metric in a tooltip so the ranking basis is explicit.
 */
export function TasteLeadersPanel({ leaders }: Props) {
    if (leaders.length === 0) {
        return (
            <div>
                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-2">
                    Taste Leaders
                </h3>
                <p className="text-sm text-muted">No taste leaders identified yet.</p>
            </div>
        );
    }
    return (
        <div>
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-2">
                Taste Leaders
            </h3>
            <ol role="list" className="space-y-1.5">
                {leaders.slice(0, 5).map((l, i) => (
                    <li key={l.userId} className="text-sm flex items-center gap-3">
                        <span className="w-5 text-xs text-muted text-right">{i + 1}.</span>
                        <span className="text-foreground flex-1">{l.username}</span>
                        <span className="text-xs text-muted" title={`Ranked by ${l.metric}`}>
                            {l.score.toFixed(2)}
                        </span>
                    </li>
                ))}
            </ol>
        </div>
    );
}
