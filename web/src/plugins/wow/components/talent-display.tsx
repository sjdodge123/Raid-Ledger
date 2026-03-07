import { useState } from 'react';
import { getWowheadTalentCalcUrl, getWowheadTalentCalcEmbedUrl } from '../lib/wowhead-urls';
import { buildWowheadTalentString } from '../lib/classic-talent-positions';

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
        talents: Array<{
            name: string;
            id?: number;
            spellId?: number;
            rank?: number;
            tierIndex?: number;
            columnIndex?: number;
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

/** Wowhead talent calculator iframe embed for Classic builds */
function WowheadTalentEmbed({ embedUrl }: { embedUrl: string }) {
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState(false);

    if (error) return null;

    return (
        <div className="hidden md:block relative w-full rounded-lg overflow-hidden border border-edge bg-overlay/30">
            {!loaded && (
                <div className="absolute inset-0 flex items-center justify-center text-muted text-sm">
                    Loading talent calculator...
                </div>
            )}
            <iframe
                src={embedUrl}
                title="Wowhead Talent Calculator"
                className="w-full border-0 overflow-hidden"
                style={{ height: 700 }}
                loading="lazy"
                sandbox="allow-scripts allow-same-origin allow-popups"
                onLoad={() => setLoaded(true)}
                onError={() => setError(true)}
            />
        </div>
    );
}

function ClassicSummaryLine({ talents, totalPoints, wowheadUrl }: { talents: ClassicTalents; totalPoints: number; wowheadUrl: string | null }) {
    return (
        <div className="flex items-center gap-3">
            <span className="text-lg font-mono font-bold text-foreground tracking-wider">{talents.summary}</span>
            {totalPoints > 0 && <span className="text-xs text-muted">({totalPoints} points)</span>}
            {wowheadUrl && (
                <a href={wowheadUrl} target="_blank" rel="noopener noreferrer"
                    className="ml-auto inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded border border-amber-700/50 bg-amber-950/40 text-amber-300 hover:bg-amber-900/50 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    View on Wowhead
                </a>
            )}
        </div>
    );
}

function getBarColor(spentPoints: number, maxPoints: number): string {
    if (spentPoints === maxPoints && spentPoints > 0) return 'bg-amber-500';
    return spentPoints > 0 ? 'bg-blue-500' : 'bg-faint';
}

function ClassicTreeRow({ tree, totalPoints, maxPoints }: { tree: ClassicTalents['trees'][number]; totalPoints: number; maxPoints: number }) {
    const pct = totalPoints > 0 ? Math.round((tree.spentPoints / totalPoints) * 100) : 0;
    const isMax = tree.spentPoints === maxPoints && maxPoints > 0;
    const pillClass = isMax ? 'bg-amber-950/40 border-amber-800/50 text-amber-300' : 'bg-overlay border-edge text-foreground';
    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
                <span className={isMax ? 'text-foreground font-medium' : 'text-muted'}>{tree.name}</span>
                <span className="text-muted font-mono">{tree.spentPoints}</span>
            </div>
            <div className="h-2 bg-faint/50 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${getBarColor(tree.spentPoints, maxPoints)}`} style={{ width: `${pct}%` }} />
            </div>
            {tree.talents.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                    {tree.talents.map((talent, i) => <span key={`${talent.name}-${i}`} className={`px-1.5 py-0.5 text-[10px] rounded border ${pillClass}`}>{talent.name}</span>)}
                </div>
            )}
        </div>
    );
}

function ClassicTalentDisplay({ talents, wowheadUrl, embedUrl }: { talents: ClassicTalents; wowheadUrl: string | null; embedUrl: string | null }) {
    const totalPoints = talents.trees.reduce((sum, t) => sum + t.spentPoints, 0);
    const maxPoints = Math.max(...talents.trees.map((t) => t.spentPoints), 0);
    return (
        <div className="space-y-4">
            <ClassicSummaryLine talents={talents} totalPoints={totalPoints} wowheadUrl={wowheadUrl} />
            {embedUrl && <WowheadTalentEmbed embedUrl={embedUrl} />}
            <div className="space-y-3">
                {talents.trees.map((tree) => <ClassicTreeRow key={tree.name} tree={tree} totalPoints={totalPoints} maxPoints={maxPoints} />)}
            </div>
        </div>
    );
}

function TalentPillSection({ label, talents, pillClass }: { label: string; talents: Array<{ name: string }>; pillClass: string }) {
    if (talents.length === 0) return null;
    return (
        <div>
            <h3 className="text-sm font-medium text-muted mb-2">{label}</h3>
            <div className="flex flex-wrap gap-1.5">
                {talents.map((talent, i) => <span key={`${talent.name}-${i}`} className={`px-2 py-1 text-xs rounded ${pillClass}`}>{talent.name}</span>)}
            </div>
        </div>
    );
}

function RetailTalentDisplay({ talents }: { talents: RetailTalents }) {
    const heroLabel = talents.heroTalents?.treeName ? `${talents.heroTalents.treeName} (Hero Talents)` : 'Hero Talents';
    return (
        <div className="space-y-4">
            <TalentPillSection label={`${talents.specName} Talents`} talents={talents.classTalents} pillClass="bg-overlay border border-edge text-foreground" />
            {talents.heroTalents && <TalentPillSection label={heroLabel} talents={talents.heroTalents.talents} pillClass="bg-purple-950/40 border border-purple-800/50 text-purple-300" />}
            {talents.classTalents.length === 0 && !talents.heroTalents && <p className="text-sm text-muted">No talent details available.</p>}
        </div>
    );
}

interface TalentDisplayProps {
    talents: unknown;
    isArmoryImported: boolean;
    characterClass?: string | null;
    gameVariant?: string | null;
}

function NoTalentData({ isArmoryImported }: { isArmoryImported: boolean }) {
    return (
        <div className="text-center py-8 text-muted">
            <p className="text-lg">No talent data</p>
            <p className="text-sm mt-1">
                {isArmoryImported ? 'Talent data may not be available for this character. Try refreshing.' : 'Talent data is only available for characters imported from the Blizzard Armory.'}
            </p>
        </div>
    );
}

function resolveClassicUrls(characterClass: string | null | undefined, talents: ClassicTalents, gameVariant: string | null | undefined) {
    const wowheadUrl = characterClass ? getWowheadTalentCalcUrl(characterClass, gameVariant) : null;
    const talentString = characterClass ? buildWowheadTalentString(characterClass, talents.trees) : null;
    const embedUrl = characterClass && talentString ? getWowheadTalentCalcEmbedUrl(characterClass, talentString, gameVariant) : null;
    const talentCalcUrl = talentString && wowheadUrl ? `${wowheadUrl}/${talentString}` : wowheadUrl;
    return { embedUrl, talentCalcUrl };
}

export function TalentDisplay({ talents, isArmoryImported, characterClass, gameVariant }: TalentDisplayProps) {
    if (!talents || !isTalentData(talents)) return <NoTalentData isArmoryImported={isArmoryImported} />;
    if (isRetailTalents(talents)) return <RetailTalentDisplay talents={talents} />;
    if (isClassicTalents(talents)) {
        const { embedUrl, talentCalcUrl } = resolveClassicUrls(characterClass, talents, gameVariant);
        return <ClassicTalentDisplay talents={talents} wowheadUrl={talentCalcUrl} embedUrl={embedUrl} />;
    }
    return <div className="text-center py-8 text-muted"><p className="text-lg">No talent data</p></div>;
}
