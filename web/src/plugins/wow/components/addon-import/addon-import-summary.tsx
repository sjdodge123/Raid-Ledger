/**
 * Summary rows + class/level diff + provenance line, shared by the preview and
 * result steps of the addon "Import string" dialog (ROK-1724 §4.4).
 */
import type { JSX } from 'react';
import type { AddonImportResultDto } from '@raid-ledger/contract';
import { diffRows, provenanceLine, summaryRows } from './addon-import.helpers';

export function AddonImportSummary({ result }: { result: AddonImportResultDto }): JSX.Element {
    const rows = [...summaryRows(result), ...diffRows(result)];
    return (
        <div className="rounded-lg border border-edge bg-panel p-3">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                {rows.map(([label, value]) => (
                    <div key={label} className="contents">
                        <dt className="text-muted">{label}</dt>
                        <dd className="text-foreground">{value}</dd>
                    </div>
                ))}
            </dl>
            <p data-testid="addon-import-provenance" className="mt-2 text-xs text-muted">{provenanceLine(result.exportedAt)}</p>
        </div>
    );
}
