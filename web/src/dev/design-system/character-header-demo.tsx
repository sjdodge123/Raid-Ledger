/**
 * ROK-2140 demos for `/dev/design-system`: the Option B action tiles, the
 * phone stat strip (`StatTile` on the `busy` / `warning` tokens) and
 * `ActionMenuList` laid out inline, as in the character page's "More" sheet.
 */
import type { JSX } from 'react';
import { ArrowPathIcon, ArrowUpTrayIcon, EllipsisHorizontalIcon, LinkSlashIcon, UserIcon } from '@heroicons/react/24/outline';
import { Button } from '../../components/ui/button';
import { ActionMenuList, type ActionMenuItem } from '../../components/ui/action-menu';
import { ACTION_TILE_CLASS, StatTile } from '../../components/shared/character-header-layout';
import { StateFrame } from './design-system-bits';

const MENU_ITEMS: ActionMenuItem[] = [
    { key: 'owner', icon: <UserIcon className="w-4 h-4" aria-hidden="true" />, label: 'Change owner', onClick: () => undefined },
    { key: 'unlink', icon: <LinkSlashIcon className="w-4 h-4" aria-hidden="true" />, label: 'Unlink character', destructive: true, onClick: () => undefined },
];

const TILES: Array<[string, JSX.Element]> = [
    ['Sync', <ArrowPathIcon className="w-5 h-5" aria-hidden="true" />],
    ['Import string', <ArrowUpTrayIcon className="w-5 h-5" aria-hidden="true" />],
    ['More', <EllipsisHorizontalIcon className="w-5 h-5" aria-hidden="true" />],
];

/** Three-up action tiles, the stat strip, and the inline action menu. */
export function CharacterHeaderDemo(): JSX.Element {
    return (
        <>
            <StateFrame label="Action tiles — ACTION_TILE_CLASS" note="Below sm: grid-flow-col auto-cols-fr; overflow goes behind More.">
                <div data-testid="demo-action-tiles" className="w-full grid grid-flow-col auto-cols-fr gap-2">
                    {TILES.map(([label, icon]) => (
                        <Button key={label} variant="secondary" size="sm" fullWidth className={ACTION_TILE_CLASS}>{icon}{label}</Button>
                    ))}
                </div>
            </StateFrame>
            <StateFrame label="StatTile strip" note="Item Level on text-item-level, Level on text-warning — tokens, so both families read.">
                <div data-testid="demo-stat-tiles" className="w-full grid grid-flow-col auto-cols-fr gap-2 text-center">
                    <StatTile value={16} label="Item Level" valueClassName="text-item-level" />
                    <StatTile value={22} label="Level" valueClassName="text-warning" />
                    <StatTile value="26m" label="Updated" />
                </div>
            </StateFrame>
            <StateFrame label="ActionMenuList — placement inline" note="The phone More sheet body; popover placement is the ⋯ menu.">
                <div className="w-full"><ActionMenuList items={MENU_ITEMS} placement="inline" label="Actions for Rok Androl" /></div>
            </StateFrame>
        </>
    );
}
