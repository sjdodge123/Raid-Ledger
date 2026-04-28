import { Link } from 'react-router-dom';
import type { CharacterDto, CharacterProfessionsDto } from '@raid-ledger/contract';
import { getClassIconUrl } from '../../plugins/wow/lib/class-icons';
import { ProfessionBadges } from '../../plugins/wow/components/ProfessionBadges';

const FACTION_STYLES: Record<string, string> = {
    alliance: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    horde: 'bg-red-500/20 text-red-400 border-red-500/30',
};

const ROLE_COLORS: Record<string, string> = {
    tank: 'bg-blue-600',
    healer: 'bg-emerald-600',
    dps: 'bg-red-600',
};

/** ROK-587: Short labels for WoW Classic game variants */
const VARIANT_LABELS: Record<string, string> = {
    classic_anniversary: 'TBC',
    classic_era: 'Era',
    classic: 'Cata',
};

interface CharacterCardCompactProps {
    /** Full CharacterDto — preferred. */
    character?: CharacterDto;
    /** Flat props (legacy). If `character` is provided these are ignored. */
    id?: string;
    name?: string;
    avatarUrl?: string | null;
    faction?: string | null;
    level?: number | null;
    race?: string | null;
    className?: string | null;
    spec?: string | null;
    role?: string | null;
    itemLevel?: number | null;
    isMain?: boolean;
    /** ROK-1130: profession data threaded into the meta row. */
    professions?: CharacterProfessionsDto | null;
    /** Visual size variant: 'default' for standard, 'sm' for compact/onboarding. */
    size?: 'default' | 'sm';
}

/**
 * Shared read-only character card used in event attendees, public profiles,
 * and onboarding. Handles mobile responsively with truncation and ellipsis.
 *
 * ROK-445: Extracted as the single source of truth for read-only character
 * card rendering. Replaces CharacterCardCompact, PublicCharacterCard, and
 * MiniCharacterCard to prevent visual drift.
 */
interface ResolvedChar {
    charId: string; charName: string; avatarUrl?: string | null; faction?: string | null;
    level?: number | null; race?: string | null; charClass?: string | null;
    spec?: string | null; role?: string | null; itemLevel?: number | null;
    isMain?: boolean; variantLabel: string | null;
    professions?: CharacterProfessionsDto | null;
}

function resolveCharProps(props: CharacterCardCompactProps): ResolvedChar {
    const { character: c } = props;
    return {
        charId: c?.id ?? props.id ?? '', charName: c?.name ?? props.name ?? '',
        avatarUrl: c?.avatarUrl ?? props.avatarUrl, faction: c?.faction ?? props.faction,
        level: c?.level ?? props.level, race: c?.race ?? props.race,
        charClass: c?.class ?? props.className, spec: c?.spec ?? props.spec,
        role: c?.effectiveRole ?? props.role, itemLevel: c?.itemLevel ?? props.itemLevel,
        isMain: c?.isMain ?? props.isMain,
        variantLabel: c?.gameVariant ? VARIANT_LABELS[c.gameVariant] : null,
        professions: c?.professions ?? props.professions ?? null,
    };
}

function CharacterAvatar({ avatarUrl, charName, size }: { avatarUrl?: string | null; charName: string; size: string }) {
    if (avatarUrl) {
        return <img src={avatarUrl} alt={charName} className={`${size} rounded-full bg-overlay flex-shrink-0`} onError={(e) => { e.currentTarget.style.display = 'none'; }} />;
    }
    return <div className={`${size} rounded-full bg-overlay flex items-center justify-center text-muted flex-shrink-0`}>👤</div>;
}

function NameRow({ charName, isMain, faction, variantLabel, textSize }: {
    charName: string; isMain?: boolean; faction?: string | null; variantLabel: string | null; textSize: string;
}) {
    return (
        <div className="flex items-center gap-2 flex-wrap">
            <span className={`font-medium text-foreground truncate max-w-[180px] sm:max-w-none ${textSize}`}>{charName}</span>
            {isMain && <span className="text-yellow-400 text-xs font-semibold inline-flex items-center gap-0.5 flex-shrink-0">⭐ Main</span>}
            {faction && <span className={`px-1.5 py-0.5 rounded text-xs font-medium border flex-shrink-0 ${FACTION_STYLES[faction] ?? 'bg-faint text-muted'}`}>{faction.charAt(0).toUpperCase() + faction.slice(1)}</span>}
            {variantLabel && <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30 flex-shrink-0">{variantLabel}</span>}
        </div>
    );
}

function MetadataRow({ level, race, charClass, spec, role, itemLevel, professions, textSize }: {
    level?: number | null; race?: string | null; charClass?: string | null;
    spec?: string | null; role?: string | null; itemLevel?: number | null;
    professions?: CharacterProfessionsDto | null; textSize: string;
}) {
    return (
        <div className={`flex items-center gap-1.5 ${textSize} text-muted flex-wrap`}>
            {level != null && level > 0 && <><span className="text-amber-400">Lv.{level}</span><span>•</span></>}
            {race && <span className="truncate max-w-[100px] sm:max-w-none">{race}</span>}
            {race && charClass && <span>•</span>}
            {charClass && (
                <span className="inline-flex items-center gap-1 truncate max-w-[120px] sm:max-w-none">
                    {getClassIconUrl(charClass) && <img src={getClassIconUrl(charClass)!} alt="" className="w-4 h-4 rounded-sm flex-shrink-0" />}
                    {charClass}
                </span>
            )}
            {spec && <span className="truncate max-w-[80px] sm:max-w-none">• {spec}</span>}
            {role && <span className={`px-1.5 py-0.5 rounded text-xs text-foreground flex-shrink-0 ${ROLE_COLORS[role] ?? 'bg-faint'}`}>{role.toUpperCase()}</span>}
            {itemLevel != null && itemLevel > 0 && <><span>•</span><span className="text-purple-400 whitespace-nowrap">{itemLevel} iLvl</span></>}
            <ProfessionBadges professions={professions ?? null} separator="•" />
        </div>
    );
}

export function CharacterCardCompact(props: CharacterCardCompactProps) {
    const { size = 'default' } = props;
    const c = resolveCharProps(props);
    const isSm = size === 'sm';

    return (
        <Link to={`/characters/${c.charId}`}
            className={`bg-panel border border-edge rounded-lg ${isSm ? 'p-3' : 'p-4'} flex items-center gap-3 min-w-0 hover:opacity-80 transition-opacity`}>
            <CharacterAvatar avatarUrl={c.avatarUrl} charName={c.charName} size={isSm ? 'w-8 h-8' : 'w-10 h-10'} />
            <div className="min-w-0 overflow-hidden">
                <NameRow charName={c.charName} isMain={c.isMain} faction={c.faction} variantLabel={c.variantLabel} textSize={isSm ? 'text-sm' : ''} />
                <MetadataRow level={c.level} race={c.race} charClass={c.charClass} spec={c.spec} role={c.role} itemLevel={c.itemLevel} professions={c.professions} textSize={isSm ? 'text-xs' : 'text-sm'} />
            </div>
        </Link>
    );
}
