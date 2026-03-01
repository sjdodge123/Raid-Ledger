import { useState } from 'react';
import { useUserReliability } from '../../hooks/use-analytics';
import type { UserReliabilityDto } from '@raid-ledger/contract';

type SortField = 'attendanceRate' | 'totalEvents' | 'noShow' | 'username';
type SortDir = 'asc' | 'desc';

export function ReliabilityLeaderboard() {
    const [sortField, setSortField] = useState<SortField>('attendanceRate');
    const [sortDir, setSortDir] = useState<SortDir>('desc');
    const { data, isLoading, error } = useUserReliability(50, 0);

    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortField(field);
            setSortDir('desc');
        }
    };

    const sorted = data
        ? [...data.users].sort((a, b) => {
              const av = a[sortField];
              const bv = b[sortField];
              if (typeof av === 'string' && typeof bv === 'string') {
                  return sortDir === 'asc'
                      ? av.localeCompare(bv)
                      : bv.localeCompare(av);
              }
              const numA = Number(av);
              const numB = Number(bv);
              return sortDir === 'asc' ? numA - numB : numB - numA;
          })
        : [];

    if (error) {
        return (
            <div className="bg-surface rounded-lg border border-edge p-6">
                <p className="text-red-400">Failed to load reliability data.</p>
            </div>
        );
    }

    return (
        <div className="bg-surface rounded-lg border border-edge p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4">
                Reliability Leaderboard
            </h3>

            {isLoading ? (
                <div className="space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <div key={i} className="h-10 bg-panel rounded animate-pulse" />
                    ))}
                </div>
            ) : sorted.length === 0 ? (
                <p className="text-muted text-center py-8">
                    No attendance data recorded yet.
                </p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-edge text-muted">
                                <th className="text-left py-2 pr-4">#</th>
                                <SortableHeader
                                    field="username"
                                    label="Player"
                                    active={sortField}
                                    dir={sortDir}
                                    onClick={handleSort}
                                />
                                <SortableHeader
                                    field="totalEvents"
                                    label="Events"
                                    active={sortField}
                                    dir={sortDir}
                                    onClick={handleSort}
                                />
                                <SortableHeader
                                    field="attendanceRate"
                                    label="Attendance %"
                                    active={sortField}
                                    dir={sortDir}
                                    onClick={handleSort}
                                />
                                <SortableHeader
                                    field="noShow"
                                    label="No-Shows"
                                    active={sortField}
                                    dir={sortDir}
                                    onClick={handleSort}
                                />
                            </tr>
                        </thead>
                        <tbody>
                            {sorted.map((user, idx) => (
                                <UserRow key={user.userId} user={user} rank={idx + 1} />
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

function SortableHeader({
    field,
    label,
    active,
    dir,
    onClick,
}: {
    field: SortField;
    label: string;
    active: SortField;
    dir: SortDir;
    onClick: (field: SortField) => void;
}) {
    const isActive = active === field;
    return (
        <th
            className="text-left py-2 pr-4 cursor-pointer hover:text-foreground select-none"
            onClick={() => onClick(field)}
        >
            {label}
            {isActive && (
                <span className="ml-1">{dir === 'asc' ? '\u2191' : '\u2193'}</span>
            )}
        </th>
    );
}

function UserRow({ user, rank }: { user: UserReliabilityDto; rank: number }) {
    const ratePercent = Math.round(user.attendanceRate * 100);
    const rateColor =
        ratePercent >= 80
            ? 'text-emerald-400'
            : ratePercent >= 50
              ? 'text-amber-400'
              : 'text-red-400';

    return (
        <tr className="border-b border-edge/50 hover:bg-panel/50 transition-colors">
            <td className="py-2 pr-4 text-muted">{rank}</td>
            <td className="py-2 pr-4">
                <span className="text-foreground">{user.username}</span>
            </td>
            <td className="py-2 pr-4 text-muted">{user.totalEvents}</td>
            <td className={`py-2 pr-4 font-semibold ${rateColor}`}>
                {ratePercent}%
            </td>
            <td className="py-2 pr-4 text-muted">{user.noShow}</td>
        </tr>
    );
}
