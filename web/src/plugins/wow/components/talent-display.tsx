/** Retail talent data shape from Blizzard API */
interface RetailTalents {
    format: 'retail';
    specName: string;
    classTalents: Array<{ name: string; id?: number }>;
    heroTalents: {
        treeName: string | null;
        talents: Array<{ name: string; id?: number }>;
    } | null;
}

/** Classic talent data shape from Blizzard API */
interface ClassicTalents {
    format: 'classic';
    trees: Array<{
        name: string;
        spentPoints: number;
        talents: Array<{ name: string; id?: number }>;
    }>;
    summary: string;
}

type TalentData = RetailTalents | ClassicTalents;

function isRetailTalents(data: TalentData): data is RetailTalents {
    return data.format === 'retail';
}

function isClassicTalents(data: TalentData): data is ClassicTalents {
    return data.format === 'classic';
}

function isTalentData(value: unknown): value is TalentData {
    if (!value || typeof value !== 'object') return false;
    const obj = value as Record<string, unknown>;
    return obj.format === 'retail' || obj.format === 'classic';
}

function RetailTalentDisplay({ talents }: { talents: RetailTalents }) {
    return (
        <div className="space-y-4">
            {/* Spec talents */}
            {talents.classTalents.length > 0 && (
                <div>
                    <h3 className="text-sm font-medium text-muted mb-2">
                        {talents.specName} Talents
                    </h3>
                    <div className="flex flex-wrap gap-1.5">
                        {talents.classTalents.map((talent, i) => (
                            <span
                                key={`${talent.name}-${i}`}
                                className="px-2 py-1 text-xs bg-overlay border border-edge rounded text-foreground"
                            >
                                {talent.name}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Hero talents */}
            {talents.heroTalents && talents.heroTalents.talents.length > 0 && (
                <div>
                    <h3 className="text-sm font-medium text-muted mb-2">
                        {talents.heroTalents.treeName
                            ? `${talents.heroTalents.treeName} (Hero Talents)`
                            : 'Hero Talents'}
                    </h3>
                    <div className="flex flex-wrap gap-1.5">
                        {talents.heroTalents.talents.map((talent, i) => (
                            <span
                                key={`${talent.name}-${i}`}
                                className="px-2 py-1 text-xs bg-purple-950/40 border border-purple-800/50 rounded text-purple-300"
                            >
                                {talent.name}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {talents.classTalents.length === 0 && !talents.heroTalents && (
                <p className="text-sm text-muted">No talent details available.</p>
            )}
        </div>
    );
}

/** Bar color based on which tree has the most points */
function getTreeBarColor(tree: ClassicTalents['trees'][number], maxPoints: number): string {
    if (tree.spentPoints === maxPoints && tree.spentPoints > 0) {
        return 'bg-amber-500';
    }
    if (tree.spentPoints > 0) {
        return 'bg-blue-500';
    }
    return 'bg-faint';
}

function ClassicTalentDisplay({ talents }: { talents: ClassicTalents }) {
    const totalPoints = talents.trees.reduce((sum, t) => sum + t.spentPoints, 0);
    const maxPoints = Math.max(...talents.trees.map((t) => t.spentPoints), 0);

    return (
        <div className="space-y-4">
            {/* Summary line */}
            <div className="flex items-center gap-3">
                <span className="text-lg font-mono font-bold text-foreground tracking-wider">
                    {talents.summary}
                </span>
                {totalPoints > 0 && (
                    <span className="text-xs text-muted">({totalPoints} points)</span>
                )}
            </div>

            {/* Tree breakdown */}
            <div className="space-y-3">
                {talents.trees.map((tree) => {
                    const pct = totalPoints > 0
                        ? Math.round((tree.spentPoints / totalPoints) * 100)
                        : 0;

                    return (
                        <div key={tree.name} className="space-y-1">
                            <div className="flex items-center justify-between text-sm">
                                <span className={tree.spentPoints === maxPoints && maxPoints > 0
                                    ? 'text-foreground font-medium'
                                    : 'text-muted'
                                }>
                                    {tree.name}
                                </span>
                                <span className="text-muted font-mono">{tree.spentPoints}</span>
                            </div>
                            <div className="h-2 bg-faint/50 rounded-full overflow-hidden">
                                <div
                                    className={`h-full rounded-full transition-all ${getTreeBarColor(tree, maxPoints)}`}
                                    style={{ width: `${pct}%` }}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

interface TalentDisplayProps {
    talents: unknown;
    isArmoryImported: boolean;
}

export function TalentDisplay({ talents, isArmoryImported }: TalentDisplayProps) {
    if (!talents || !isTalentData(talents)) {
        return (
            <div className="text-center py-8 text-muted">
                <p className="text-lg">No talent data</p>
                <p className="text-sm mt-1">
                    {isArmoryImported
                        ? 'Talent data may not be available for this character. Try refreshing.'
                        : 'Talent data is only available for characters imported from the Blizzard Armory.'}
                </p>
            </div>
        );
    }

    if (isRetailTalents(talents)) {
        return <RetailTalentDisplay talents={talents} />;
    }

    if (isClassicTalents(talents)) {
        return <ClassicTalentDisplay talents={talents} />;
    }

    return (
        <div className="text-center py-8 text-muted">
            <p className="text-lg">No talent data</p>
        </div>
    );
}
