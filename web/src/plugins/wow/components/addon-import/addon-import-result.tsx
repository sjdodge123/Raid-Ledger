/**
 * Result step of the addon "Import string" dialog (ROK-1724 §4.4): a `success`
 * status banner (design-system §4.7) + the same summary as the preview, with
 * "Import another" / "Done" in the footer (`AddonImportResultActions`).
 */
import type { JSX } from 'react';
import type { AddonImportResultDto } from '@raid-ledger/contract';
import { Button } from '../../../../components/ui/button';
import { AddonImportSummary } from './addon-import-summary';
import { resultHeadline } from './addon-import.helpers';

export function AddonImportResult({ result }: { result: AddonImportResultDto }): JSX.Element {
    return (
        <div className="space-y-3">
            <div role="status" data-testid="addon-import-success" className="p-3 rounded-lg border bg-success/10 border-success/30 text-sm font-medium text-success">
                {resultHeadline(result)}
            </div>
            <AddonImportSummary result={result} />
        </div>
    );
}

export interface AddonImportResultActionsProps {
    onImportAnother: () => void;
    onDone: () => void;
}

/** Footer for the result step. */
export function AddonImportResultActions({ onImportAnother, onDone }: AddonImportResultActionsProps): JSX.Element {
    return (
        <>
            <Button variant="ghost" onClick={onImportAnother}>Import another</Button>
            <Button onClick={onDone}>Done</Button>
        </>
    );
}
