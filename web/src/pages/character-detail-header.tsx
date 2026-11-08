/**
 * ROK-2140 — the character detail header. Below `sm` it is the Option B
 * profile card (centred hero, stat tiles, three-up actions); at ≥ `sm` it keeps
 * the desktop row. Game plugins fill the badge/stat/action slots and get the
 * `layout` hint in their context; core never imports plugin code.
 */
import { useState, type JSX, type ReactNode } from 'react';
import type { CharacterDto } from '@raid-ledger/contract';
import { PluginSlot } from '../plugins';
import { useCharacterLocationLabel } from '../plugins/character-identity';
import { CharacterPortraitFallback } from '../plugins/character-portrait';
import type { CharacterPortraitSize } from '../plugins/character-identity';
import { useMediaQuery } from '../hooks/use-media-query';
import { compactJoin } from '../lib/compact-join';
import { StatTile, type CharacterHeaderLayout } from '../components/shared/character-header-layout';
import { CharacterRoleBadge } from './character-role-editor';

/** Below Tailwind's `sm` (640px). */
const PHONE_MQ = '(max-width: 639px)';

interface HeaderProps { character: CharacterDto; isOwner: boolean; isArmoryImported: boolean; isAdminViewer: boolean }

function CharacterAvatar({ avatarUrl, name, sizeClass }: { avatarUrl: string | null; name: string; sizeClass: string }): JSX.Element {
    // Track which URL failed so a corrected avatar URL is retried.
    const [erroredUrl, setErroredUrl] = useState<string | null>(null);
    const url = avatarUrl && avatarUrl !== erroredUrl ? avatarUrl : null;
    if (url) return <img src={url} alt={name} className={`${sizeClass} rounded-full bg-overlay flex-shrink-0`} onError={() => setErroredUrl(url)} />;
    return <div className={`${sizeClass} rounded-full bg-overlay flex items-center justify-center text-3xl text-muted flex-shrink-0`}>&#128100;</div>;
}

/** `size` is the plugin portrait's size; `sizeClass` sizes the core avatar it wraps — keep them the same pixels. */
function Portrait({ character, size, sizeClass }: { character: CharacterDto; size: CharacterPortraitSize; sizeClass: string }): JSX.Element {
    return (
        <CharacterPortraitFallback character={character} size={size}>
            <CharacterAvatar avatarUrl={character.avatarUrl} name={character.name} sizeClass={sizeClass} />
        </CharacterPortraitFallback>
    );
}

/** Slot context shared by both `character-detail:header-badges` parts. */
function badgeContext(character: CharacterDto): Record<string, unknown> {
    return { faction: character.faction, itemLevel: character.itemLevel, equippedItemLevel: character.equipment?.equippedItemLevel ?? null, lastSyncedAt: character.lastSyncedAt, profileUrl: character.profileUrl, level: character.level };
}

/** ROK-1733: a realmless character shows its plugin's location label (e.g. "PvP (US)") in the realm slot. */
function useRealmLabel(character: CharacterDto): string | null {
    const locationLabel = useCharacterLocationLabel();
    return character.realm || locationLabel(character) || null;
}

/** ≥ sm meta: every item is a nowrap unit led by a fixed-width "·"; the row is shifted left by one separator inside an overflow-hidden box, so a "·" that starts a line is clipped — never a dangling dot. */
function DesktopMeta({ character }: { character: CharacterDto }): JSX.Element | null {
    const realm = useRealmLabel(character);
    const items: Array<[string, ReactNode]> = [];
    if (character.level) items.push(['level', <span className="text-amber-400">Level {character.level}</span>]);
    for (const [key, value] of [['race', character.race], ['class', character.class], ['spec', character.spec], ['realm', realm]] as const) {
        if (value) items.push([key, <span>{value}</span>]);
    }
    if (items.length === 0) return null;
    return (
        <div className="mt-1 overflow-hidden text-sm text-muted">
            <div className="-ml-4 flex flex-wrap">
                {items.map(([key, node]) => <span key={key} className="whitespace-nowrap"><span aria-hidden="true" className="inline-block w-4 text-center">·</span>{node}</span>)}
            </div>
        </div>
    );
}

function PhoneMeta({ character }: { character: CharacterDto }): JSX.Element | null {
    const realm = useRealmLabel(character);
    const line = compactJoin([compactJoin([character.race, character.class], ' '), character.spec]);
    if (!line && !realm) return null;
    return <div className="mt-3 text-sm text-muted">{line && <div>{line}</div>}{realm && <div>{realm}</div>}</div>;
}

const ACTION_ROW: Record<CharacterHeaderLayout, string> = {
    phone: 'mt-4 grid grid-flow-col auto-cols-fr gap-2 empty:hidden',
    desktop: 'col-start-2 mt-3 flex flex-wrap items-center gap-2 empty:hidden',
};

function HeaderActions({ character, isOwner, isArmoryImported, isAdminViewer, layout }: HeaderProps & { layout: CharacterHeaderLayout }): JSX.Element {
    const c = character;
    return (
        <div data-testid="character-header-actions" className={ACTION_ROW[layout]}>
            {isOwner && isArmoryImported && <PluginSlot name="profile:character-actions" context={{ characterId: c.id, lastSyncedAt: c.lastSyncedAt, region: c.region, gameVariant: c.gameVariant, layout }} />}
            {isOwner && <PluginSlot name="character-detail:owner-actions" context={{ characterId: c.id, gameId: c.gameId, name: c.name, region: c.region, ruleset: c.ruleset, gameVariant: c.gameVariant, class: c.class, level: c.level, layout }} />}
            {/* Admin-only (ROK-1756, ROK-2128); the plugin filler self-filters and renders the ⋯ menu / More sheet. */}
            {isAdminViewer && <PluginSlot name="character-detail:admin-actions" context={{ characterId: c.id, name: c.name, userId: c.userId, addonLinked: c.addonLinked, rosterClaimed: c.rosterClaimed === true, layout }} />}
        </div>
    );
}

/** Phone hero (Option B): everything above the action row. */
function PhoneHero(props: HeaderProps): JSX.Element {
    const { character } = props;
    const levelTile = character.level ? <StatTile value={character.level} label="Level" valueClassName="text-warning" /> : null;
    return (
        <>
            <div className="mt-1 mb-2.5 flex justify-center"><Portrait character={character} size="phone" sizeClass="w-[72px] h-[72px]" /></div>
            <h1 className="text-xl font-bold text-foreground">{character.name}</h1>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2 empty:hidden">
                <PluginSlot name="character-detail:header-badges" context={{ characterId: character.id, ...badgeContext(character), part: 'chips', layout: 'phone' }} />
            </div>
            <div className="mt-4 grid grid-flow-col auto-cols-fr gap-2 empty:hidden">
                <PluginSlot name="character-detail:header-badges" context={{ characterId: character.id, ...badgeContext(character), part: 'stats', layout: 'phone' }} fallback={levelTile} />
            </div>
            <PhoneMeta character={character} />
            <div className="mt-2.5 flex items-center justify-center gap-3 empty:hidden"><CharacterRoleBadge character={character} isOwner={props.isOwner} /></div>
        </>
    );
}

/** Desktop hero: the portrait (spanning both grid rows) and the info column; the action row sits under the info column. */
function DesktopHero(props: HeaderProps): JSX.Element {
    const { character } = props;
    return (
        <>
            <div className="row-span-2"><Portrait character={character} size="lg" sizeClass="w-20 h-20" /></div>
            <div className="min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                    <h1 className="text-2xl font-bold text-foreground">{character.name}</h1>
                    <PluginSlot name="character-detail:header-badges" context={{ characterId: character.id, ...badgeContext(character), part: 'chips', layout: 'desktop' }} />
                    <CharacterRoleBadge character={character} isOwner={props.isOwner} />
                </div>
                <PluginSlot name="character-detail:header-badges" context={{ characterId: character.id, ...badgeContext(character), part: 'stats', layout: 'desktop' }} />
                <DesktopMeta character={character} />
            </div>
        </>
    );
}

const SHELL: Record<CharacterHeaderLayout, string> = {
    phone: 'bg-panel border border-edge rounded-lg p-4 text-center',
    desktop: 'bg-panel border border-edge rounded-lg p-6 grid grid-cols-[auto_minmax(0,1fr)] grid-rows-[auto_1fr] items-start gap-x-4',
};

/**
 * The character header: Option B below `sm`, the desktop row at ≥ `sm` (ROK-2140).
 * Only the hero swaps across the breakpoint; the shell and the action row keep
 * their tree position, so a stateful action (an open import dialog with a pasted
 * string) stays mounted when a phone rotates past 640px.
 */
export function CharacterHeader(props: HeaderProps): JSX.Element {
    const layout: CharacterHeaderLayout = useMediaQuery(PHONE_MQ) ? 'phone' : 'desktop';
    return (
        <div data-testid={`character-header-${layout}`} className={SHELL[layout]}>
            {layout === 'phone' ? <PhoneHero {...props} /> : <DesktopHero {...props} />}
            <HeaderActions {...props} layout={layout} />
        </div>
    );
}
