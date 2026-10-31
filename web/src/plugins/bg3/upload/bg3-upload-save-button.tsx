/** ROK-1960 §5 — the "Upload a save" entry button (Party empty state, Campaign tab → Your saves). */
import type { JSX } from 'react';
import { ArrowUpTrayIcon } from '@heroicons/react/24/outline';
import { Button } from '../../../components/ui/button';

export function Bg3UploadSaveButton({ onClick }: { onClick: () => void }): JSX.Element {
    return (
        <Button variant="secondary" size="sm" onClick={onClick}>
            <ArrowUpTrayIcon className="w-4 h-4" aria-hidden="true" />
            Upload a save
        </Button>
    );
}
