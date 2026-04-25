import type { CommunitySocialGraphResponseDto } from '@raid-ledger/contract';

interface Props {
    data: CommunitySocialGraphResponseDto;
}

/**
 * Accessible `<table>` fallback for the force-directed social graph. Each
 * row lists one player with their archetype tier, clique id, degree, and
 * up to 3 top co-play partners.
 */
export function SocialGraphFallbackTable({ data }: Props) {
    const partnersByUser = buildTopPartners(data);
    return (
        <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
                <caption className="sr-only">Community social graph as a table</caption>
                <thead>
                    <tr className="text-left text-xs uppercase tracking-wider text-muted">
                        <th scope="col" className="py-2 pr-4">Player</th>
                        <th scope="col" className="py-2 pr-4">Tier</th>
                        <th scope="col" className="py-2 pr-4">Clique</th>
                        <th scope="col" className="py-2 pr-4">Connections</th>
                        <th scope="col" className="py-2">Top partners</th>
                    </tr>
                </thead>
                <tbody>
                    {data.nodes.map((n) => (
                        <tr key={n.userId} className="border-t border-edge/30" tabIndex={0}>
                            <td className="py-2 pr-4 text-foreground">{n.username}</td>
                            <td className="py-2 pr-4 text-muted">{n.intensityTier}</td>
                            <td className="py-2 pr-4 text-muted">#{n.cliqueId}</td>
                            <td className="py-2 pr-4 text-muted">{n.degree}</td>
                            <td className="py-2 text-muted">
                                {(partnersByUser.get(n.userId) ?? []).join(', ') || '—'}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function buildTopPartners(data: CommunitySocialGraphResponseDto): Map<number, string[]> {
    const nameById = new Map(data.nodes.map((n) => [n.userId, n.username]));
    const edgesByUser = new Map<number, { userId: number; weight: number }[]>();
    for (const e of data.edges) {
        pushEdge(edgesByUser, e.sourceUserId, e.targetUserId, e.weight);
        pushEdge(edgesByUser, e.targetUserId, e.sourceUserId, e.weight);
    }
    const out = new Map<number, string[]>();
    for (const [userId, partners] of edgesByUser) {
        const top = partners
            .sort((a, b) => b.weight - a.weight)
            .slice(0, 3)
            .map((p) => nameById.get(p.userId) ?? `#${p.userId}`);
        out.set(userId, top);
    }
    return out;
}

function pushEdge(
    map: Map<number, { userId: number; weight: number }[]>,
    from: number, to: number, weight: number,
) {
    const list = map.get(from) ?? [];
    list.push({ userId: to, weight });
    map.set(from, list);
}
