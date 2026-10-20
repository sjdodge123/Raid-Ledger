/**
 * ROK-1870 (operator ruling 2026-10-20 17:05Z) — the permanent "Hubs" nav
 * item for signed-in members: a row under the More drawer's "Your hubs"
 * block (phone) and a "Browse hubs" entry in the user-menu hub group
 * (tablet; from 1024px the header bar's Hubs link takes over). The desktop
 * header link itself lives in `Header`'s link list.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRightIcon, UserGroupIcon } from '@heroicons/react/24/outline';
import { navClass } from '../nav-class';
import { HUBS_PATH } from './my-hubs-queries';

/** More-drawer row to the `/hubs` directory; tapping it closes the drawer. */
export function DrawerHubsLink({ onClose, active }: { onClose?: (() => void) | undefined; active: boolean }): JSX.Element {
    return (
        <Link to={HUBS_PATH} onClick={onClose} data-testid="drawer-hubs-link" aria-current={active ? 'page' : undefined}
            className={`flex min-h-[44px] items-center gap-3 border-b border-edge-subtle px-4 py-2 text-sm font-medium transition-colors hover:bg-overlay ${active ? navClass('on', 'on') : 'text-foreground'}`}>
            <UserGroupIcon className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
            <span className="flex-1">Hubs</span>
            <ChevronRightIcon className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
        </Link>
    );
}

/** User-menu item to the `/hubs` directory, 768–1023px (the header bar has the link from lg). */
export function UserMenuBrowseHubs({ onClose }: { onClose?: (() => void) | undefined }): JSX.Element {
    return (
        <Link to={HUBS_PATH} onClick={onClose} data-testid="user-menu-browse-hubs"
            className="flex items-center gap-2 px-4 py-2 text-secondary transition-colors hover:bg-panel hover:text-foreground lg:hidden">
            <UserGroupIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Browse hubs</span>
        </Link>
    );
}
