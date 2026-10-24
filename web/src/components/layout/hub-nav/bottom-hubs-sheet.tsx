/**
 * ROK-1875 (operator ruling 2026-10-21) — the "Your hubs" sheet the phone
 * bottom bar's centre Hubs circle opens: the same rows as the header Hubs menu
 * (`GuildRows`, each with its kind chip), then "Browse all hubs →". Picking
 * either closes the sheet. Lazy-loaded by `bottom-hubs-button.tsx` so the
 * sheet stays out of the initial bundle.
 *
 * Operator 2026-10-24: larger and easier to read — the `lg` rows (64px, 40px
 * icon, `text-base`), a taller cap, and a floor of half the visible viewport
 * (`--sheet-vh`) so two or three hubs don't leave a short stub.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import type { MyGuild } from '@raid-ledger/contract';
import { BottomSheet } from '../../ui/bottom-sheet';
import { GuildRows } from './hub-entry-bits';
import { HUBS_PATH } from './my-hubs-queries';

interface Props { isOpen: boolean; onClose: () => void; hubs: MyGuild[] }

/** "Your hubs" BottomSheet: one row per hub, then Browse all hubs. */
export default function BottomHubsSheet({ isOpen, onClose, hubs }: Props): JSX.Element {
    return (
        <BottomSheet isOpen={isOpen} onClose={onClose} title="Your hubs" maxHeight="88vh">
            <div className="-mx-4 -my-4 min-h-[calc(var(--sheet-vh,1dvh)_*_50)]" data-testid="bottom-hubs-sheet">
                <GuildRows guilds={hubs} onNavigate={onClose} size="lg" />
                <Link to={HUBS_PATH} onClick={onClose} data-testid="bottom-hubs-browse-all"
                    className="flex min-h-[64px] w-full items-center gap-1 border-t border-edge px-5 py-3 text-base font-medium text-secondary transition-colors hover:bg-overlay hover:text-foreground">
                    Browse all hubs <span aria-hidden="true">→</span>
                </Link>
            </div>
        </BottomSheet>
    );
}
