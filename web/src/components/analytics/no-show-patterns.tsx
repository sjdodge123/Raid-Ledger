import { useUserReliability } from '../../hooks/use-analytics';

export function NoShowPatterns() {
    const { data, isLoading, error } = useUserReliability(50, 0);

    if (error) {
        return (
            <div className="bg-surface rounded-lg border border-edge p-6">
                <p className="text-red-400">Failed to load no-show patterns.</p>
            </div>
        );
    }

    // Derive repeat offenders from the user reliability data
    const repeatOffenders = data
        ? data.users
              .filter((u) => u.noShow >= 2)
              .sort((a, b) => b.noShow - a.noShow)
              .slice(0, 10)
        : [];

    return (
        <div className="bg-surface rounded-lg border border-edge p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4">
                No-Show Patterns
            </h3>

            {isLoading ? (
                <div className="space-y-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="h-10 bg-panel rounded animate-pulse" />
                    ))}
                </div>
            ) : (
                <div className="space-y-6">
                    {/* Repeat Offenders */}
                    <div>
                        <h4 className="text-sm font-medium text-muted mb-3">
                            Repeat Offenders
                        </h4>
                        {repeatOffenders.length === 0 ? (
                            <p className="text-muted text-sm">
                                No repeat offenders found.
                            </p>
                        ) : (
                            <div className="space-y-2">
                                {repeatOffenders.map((user) => {
                                    const rate = Math.round(
                                        (user.noShow / user.totalEvents) * 100,
                                    );
                                    return (
                                        <div
                                            key={user.userId}
                                            className="flex items-center justify-between py-2 px-3 bg-panel rounded-lg"
                                        >
                                            <span className="text-foreground text-sm">
                                                {user.username}
                                            </span>
                                            <div className="flex items-center gap-3 text-sm">
                                                <span className="text-red-400 font-semibold">
                                                    {user.noShow} no-shows
                                                </span>
                                                <span className="text-muted">
                                                    ({rate}% of {user.totalEvents} events)
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                </div>
            )}
        </div>
    );
}
