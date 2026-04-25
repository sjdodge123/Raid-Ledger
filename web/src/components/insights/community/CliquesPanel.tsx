import type { CliqueDto, SocialGraphNodeDto } from '@raid-ledger/contract';

interface Props {
    cliques: CliqueDto[];
    nodes: SocialGraphNodeDto[];
}

/**
 * Side panel listing Louvain cliques with member pills. Clique order is
 * stable (sorted by member count desc server-side).
 */
export function CliquesPanel({ cliques, nodes }: Props) {
    const nameById = new Map(nodes.map((n) => [n.userId, n.username]));
    if (cliques.length === 0) {
        return <EmptyPanel title="Cliques" hint="No cliques detected yet." />;
    }
    return (
        <div>
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-2">
                Cliques
            </h3>
            <ul role="list" className="space-y-3">
                {cliques.slice(0, 6).map((c) => (
                    <li key={c.cliqueId} className="text-sm">
                        <div className="text-xs text-muted mb-1">
                            Clique #{c.cliqueId} · {c.memberUserIds.length} members
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {c.memberUserIds.slice(0, 8).map((uid) => (
                                <span key={uid}
                                    className="px-2 py-0.5 text-xs bg-panel border border-edge rounded text-muted">
                                    {nameById.get(uid) ?? `#${uid}`}
                                </span>
                            ))}
                            {c.memberUserIds.length > 8 && (
                                <span className="text-xs text-muted">+{c.memberUserIds.length - 8}</span>
                            )}
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    );
}

function EmptyPanel({ title, hint }: { title: string; hint: string }) {
    return (
        <div>
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-2">{title}</h3>
            <p className="text-sm text-muted">{hint}</p>
        </div>
    );
}
