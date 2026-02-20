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

/** Classic talent data shape from Blizzard API (enhanced with grid positions) */
interface ClassicTalents {
    format: 'classic';
    trees: Array<{
        name: string;
        spentPoints: number;
        talents: Array<{
            name: string;
            id?: number;
            spellId?: number;
            tier?: number;
            column?: number;
        }>;
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

/** Check whether talent data includes grid position info (tier/column) */
function hasGridPositions(trees: ClassicTalents['trees']): boolean {
    return trees.some((tree) =>
        tree.talents.some(
            (t) => t.tier !== undefined && t.tier !== null && t.column !== undefined && t.column !== null,
        ),
    );
}

/** Classic WoW talent trees have 4 columns and up to 7 tiers (rows 0-6, 11-point intervals) */
const TREE_COLUMNS = 4;
const TREE_MAX_TIERS = 7;

/** Talent tree name to header color */
const TREE_HEADER_COLORS: Record<string, string> = {
    // Druid
    Balance: 'text-orange-400',
    'Feral Combat': 'text-amber-400',
    Feral: 'text-amber-400',
    Restoration: 'text-green-400',
    // Warrior
    Arms: 'text-red-400',
    Fury: 'text-amber-400',
    // Paladin
    Holy: 'text-yellow-300',
    Retribution: 'text-rose-400',
    // Priest
    Discipline: 'text-gray-200',
    Shadow: 'text-purple-400',
    // Mage
    Arcane: 'text-sky-300',
    Fire: 'text-red-400',
    Frost: 'text-blue-300',
    // Warlock
    Affliction: 'text-purple-400',
    Demonology: 'text-red-400',
    Destruction: 'text-orange-400',
    // Rogue
    Assassination: 'text-yellow-400',
    Combat: 'text-red-400',
    Subtlety: 'text-purple-300',
    // Hunter
    'Beast Mastery': 'text-red-400',
    Marksmanship: 'text-amber-400',
    Survival: 'text-green-400',
    // Shaman
    Elemental: 'text-blue-300',
    Enhancement: 'text-red-400',
    // DK
    Blood: 'text-red-500',
    Unholy: 'text-green-500',
    // Shared names with context-dependent colors default to most common
    Protection: 'text-sky-300',
};

function getTreeHeaderColor(treeName: string): string {
    return TREE_HEADER_COLORS[treeName] ?? 'text-amber-400';
}

interface TalentNodeProps {
    talent: ClassicTalents['trees'][number]['talents'][number];
    isMaxTree: boolean;
}

function TalentNode({ talent, isMaxTree }: TalentNodeProps) {
    // Construct Wowhead icon URL from spell ID if available
    // Classic Wowhead: https://wow.zamimg.com/images/wow/icons/medium/{spell_id}.jpg
    // We use the talent spell ID to show the icon
    const hasSpellId = talent.spellId && talent.spellId > 0;

    return (
        <div
            className="group relative flex flex-col items-center"
            title={talent.name}
        >
            {/* Talent icon container */}
            <div
                className={`
                    w-9 h-9 sm:w-10 sm:h-10 rounded border-2 flex items-center justify-center
                    transition-all overflow-hidden
                    ${isMaxTree
                        ? 'border-amber-500/80 bg-amber-950/40 shadow-[0_0_6px_rgba(245,158,11,0.3)]'
                        : 'border-blue-500/60 bg-blue-950/40'
                    }
                `}
            >
                {hasSpellId ? (
                    <img
                        src={`https://wow.zamimg.com/images/wow/icons/medium/${talent.spellId}.jpg`}
                        alt={talent.name}
                        className="w-full h-full object-cover rounded-sm"
                        onError={(e) => {
                            // Fall back to text on icon load failure
                            const parent = e.currentTarget.parentElement;
                            if (parent) {
                                e.currentTarget.style.display = 'none';
                                const fallback = parent.querySelector('.talent-fallback');
                                if (fallback) (fallback as HTMLElement).style.display = 'flex';
                            }
                        }}
                    />
                ) : null}
                <span
                    className={`talent-fallback text-[10px] font-bold leading-tight text-center px-0.5
                        ${isMaxTree ? 'text-amber-300' : 'text-blue-300'}
                        ${hasSpellId ? 'hidden' : 'flex'}
                        items-center justify-center w-full h-full`}
                >
                    {talent.name.length <= 4
                        ? talent.name
                        : talent.name
                            .split(/[\s-]+/)
                            .map((w) => w[0])
                            .join('')
                            .toUpperCase()
                            .slice(0, 3)}
                </span>
            </div>

            {/* Tooltip on hover */}
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1
                bg-gray-900 border border-edge rounded text-xs text-foreground whitespace-nowrap
                opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10
                shadow-lg">
                {talent.name}
            </div>
        </div>
    );
}

interface ClassicTreeGridProps {
    tree: ClassicTalents['trees'][number];
    isMaxTree: boolean;
}

function ClassicTreeGrid({ tree, isMaxTree }: ClassicTreeGridProps) {
    // Determine which tiers have talents
    const maxTier = tree.talents.reduce((max, t) => Math.max(max, t.tier ?? 0), 0);
    const tierCount = Math.max(maxTier + 1, Math.min(TREE_MAX_TIERS, maxTier + 1));

    // Build a lookup: tier -> column -> talent
    const grid = new Map<string, ClassicTalents['trees'][number]['talents'][number]>();
    for (const talent of tree.talents) {
        if (talent.tier !== undefined && talent.column !== undefined) {
            grid.set(`${talent.tier}-${talent.column}`, talent);
        }
    }

    const headerColor = getTreeHeaderColor(tree.name);

    return (
        <div className="flex flex-col">
            {/* Tree header */}
            <div className="text-center mb-2 pb-2 border-b border-edge/50">
                <h4 className={`text-sm font-bold ${headerColor}`}>
                    {tree.name}
                </h4>
                <span className="text-xs text-muted font-mono">{tree.spentPoints} pts</span>
            </div>

            {/* Talent grid */}
            <div className="bg-gray-950/60 rounded-lg p-2 sm:p-3 border border-edge/30">
                <div className="space-y-1.5">
                    {Array.from({ length: tierCount }, (_, tier) => (
                        <div key={tier} className="grid grid-cols-4 gap-1 sm:gap-1.5">
                            {Array.from({ length: TREE_COLUMNS }, (_, col) => {
                                const talent = grid.get(`${tier}-${col}`);
                                if (!talent) {
                                    return <div key={col} className="w-9 h-9 sm:w-10 sm:h-10" />;
                                }
                                return (
                                    <TalentNode
                                        key={col}
                                        talent={talent}
                                        isMaxTree={isMaxTree}
                                    />
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

/** Fallback list view for talent data without grid positions (legacy data) */
function ClassicTalentListFallback({ talents }: { talents: ClassicTalents }) {
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

            {/* Tree breakdown with talent pills */}
            <div className="space-y-3">
                {talents.trees.map((tree) => {
                    const pct = totalPoints > 0
                        ? Math.round((tree.spentPoints / totalPoints) * 100)
                        : 0;
                    const barColor = tree.spentPoints === maxPoints && tree.spentPoints > 0
                        ? 'bg-amber-500'
                        : tree.spentPoints > 0
                            ? 'bg-blue-500'
                            : 'bg-faint';

                    return (
                        <div key={tree.name} className="space-y-1.5">
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
                                    className={`h-full rounded-full transition-all ${barColor}`}
                                    style={{ width: `${pct}%` }}
                                />
                            </div>
                            {tree.talents.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                    {tree.talents.map((talent, i) => (
                                        <span
                                            key={`${talent.name}-${i}`}
                                            className={`px-1.5 py-0.5 text-[10px] rounded border
                                                ${tree.spentPoints === maxPoints
                                                    ? 'bg-amber-950/40 border-amber-800/50 text-amber-300'
                                                    : 'bg-overlay border-edge text-foreground'
                                                }`}
                                        >
                                            {talent.name}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function ClassicTalentDisplay({ talents }: { talents: ClassicTalents }) {
    const totalPoints = talents.trees.reduce((sum, t) => sum + t.spentPoints, 0);
    const maxPoints = Math.max(...talents.trees.map((t) => t.spentPoints), 0);
    const hasGrid = hasGridPositions(talents.trees);

    // If no grid positions available (legacy data), use fallback
    if (!hasGrid) {
        return <ClassicTalentListFallback talents={talents} />;
    }

    return (
        <div className="space-y-4">
            {/* Summary bar */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <span className="text-lg font-mono font-bold text-foreground tracking-wider">
                        {talents.summary}
                    </span>
                    {totalPoints > 0 && (
                        <span className="text-xs text-muted">({totalPoints} points)</span>
                    )}
                </div>
                <span className="text-xs text-muted/60">Talent Build</span>
            </div>

            {/* Three trees side by side */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
                {talents.trees.map((tree) => (
                    <ClassicTreeGrid
                        key={tree.name}
                        tree={tree}
                        isMaxTree={tree.spentPoints === maxPoints && maxPoints > 0}
                    />
                ))}
            </div>
        </div>
    );
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
