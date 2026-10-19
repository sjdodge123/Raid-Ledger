/**
 * ROK-1836 L4 (D10) — the admin "Change owner" trigger. The dialog (search,
 * history, footer) is a lazy chunk loaded on first open.
 */
import { lazy, Suspense, useState } from 'react';
import type { ValheimCharacterSummary } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';

const ChangeOwnerDialog = lazy(() => import('./change-owner-dialog'));

interface ChangeOwnerSheetProps {
    character: ValheimCharacterSummary;
}

export function ChangeOwnerSheet({ character }: ChangeOwnerSheetProps) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <Button variant="secondary" onClick={() => setOpen(true)}>
                Change owner
            </Button>
            {open && (
                <Suspense fallback={null}>
                    <ChangeOwnerDialog
                        character={character}
                        onClose={() => setOpen(false)}
                    />
                </Suspense>
            )}
        </>
    );
}
