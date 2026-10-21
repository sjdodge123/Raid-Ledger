/**
 * ROK-1870/ROK-1875 — the phone entry to the `/hubs` directory: a "Browse all
 * hubs" row under the More drawer's "Your hubs" block. From 768px the header's
 * Hubs item (`hubs-nav-menu.tsx`) is the entry; the tablet user-menu hub group
 * was dropped as a duplicate of it (ROK-1875 §9 Q1).
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
            <span className="flex-1">Browse all hubs</span>
            <ChevronRightIcon className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
        </Link>
    );
}
