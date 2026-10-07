/**
 * What a create-route import will do (ROK-1738 D3/D10): a §4.7 status banner
 * above the preview summary. `create` → success tone, "Creates <Name> · <REGION>
 * · <ruleset> · Level <n> <Class>"; `update` → warning tone with the ruled copy
 * "Already on your account — this will update <name>". Tokens only.
 */
import type { JSX } from 'react';
import { WOW_FOREVER_RULESET_LABELS, type AddonImportTargetDto } from '@raid-ledger/contract';

/** Shown in the create line when the export carries no ruleset (the picker below asks for one). */
const RULESET_NOT_IN_EXPORT = 'ruleset not in export';

function createTargetLine(target: AddonImportTargetDto): string {
    const ruleset = target.ruleset === null ? RULESET_NOT_IN_EXPORT : WOW_FOREVER_RULESET_LABELS[target.ruleset];
    return `Creates ${target.name} · ${target.region.toUpperCase()} · ${ruleset} · Level ${target.level} ${target.class}`;
}

function updateTargetLine(target: AddonImportTargetDto): string {
    return `Already on your account — this will update ${target.name}`;
}

const TONE: Record<AddonImportTargetDto['action'], string> = {
    create: 'bg-success/10 border-success/30 text-success',
    update: 'bg-warning/10 border-warning/30 text-warning',
};

export function AddonImportTargetBanner({ target }: { target: AddonImportTargetDto }): JSX.Element {
    const line = target.action === 'create' ? createTargetLine(target) : updateTargetLine(target);
    return (
        <div data-testid="addon-import-target" data-action={target.action} className={`p-3 rounded-lg border ${TONE[target.action]}`}>
            <p className="text-sm font-medium">{line}</p>
        </div>
    );
}
