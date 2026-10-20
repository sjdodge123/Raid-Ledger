/**
 * What a create-route import will do (ROK-1738 D3/D10): a §4.7 status banner
 * above the preview summary. `create` → success tone, "Creates <Name> · <REGION>
 * · <ruleset> · Level <n> <Class>"; `update` → warning tone with the ruled copy
 * "Already on your account — this will update <name>". Tokens only.
 */
import type { JSX } from 'react';
import {
    WOW_FOREVER_RULESET_LABELS,
    type AddonImportRulesetInferenceDto,
    type AddonImportTargetDto,
    type WowForeverSelectableRuleset,
} from '@raid-ledger/contract';
import { selectableInference } from './addon-import.helpers';

/** Shown in the create line when the export carries no ruleset (the picker below asks for one). */
const RULESET_NOT_IN_EXPORT = 'ruleset not in export';

type Pick = WowForeverSelectableRuleset | null | undefined;

/**
 * ROK-1739 §6.3: with no export ruleset the line names the user's current pick,
 * labelled "(inferred from <realm>)" only while that pick still equals the
 * realm inference — an override reads as the plain picked label.
 */
function rulesetText(target: AddonImportTargetDto, inference: AddonImportRulesetInferenceDto | undefined, pick: Pick): string {
    if (target.ruleset !== null) return WOW_FOREVER_RULESET_LABELS[target.ruleset];
    if (!pick) return RULESET_NOT_IN_EXPORT;
    const label = WOW_FOREVER_RULESET_LABELS[pick];
    return inference && selectableInference(inference) === pick ? `${label} (inferred from ${inference.realmName})` : label;
}

function createTargetLine(target: AddonImportTargetDto, inference: AddonImportRulesetInferenceDto | undefined, pick: Pick): string {
    const ruleset = rulesetText(target, inference, pick);
    return `Creates ${target.name} · ${target.region.toUpperCase()} · ${ruleset} · Level ${target.level} ${target.class}`;
}

function updateTargetLine(target: AddonImportTargetDto): string {
    return `Already on your account — this will update ${target.name}`;
}

const TONE: Record<AddonImportTargetDto['action'], string> = {
    create: 'bg-success/10 border-success/30 text-success',
    update: 'bg-warning/10 border-warning/30 text-warning',
};

export interface AddonImportTargetBannerProps {
    target: AddonImportTargetDto;
    /** ROK-1739: the preview's realm inference, shown in place of a missing export ruleset. */
    inference?: AddonImportRulesetInferenceDto | undefined;
    /** The ruleset currently picked below (D13) — what a null-ruleset create will actually use. */
    pick?: Pick;
}

export function AddonImportTargetBanner({ target, inference, pick }: AddonImportTargetBannerProps): JSX.Element {
    const line = target.action === 'create' ? createTargetLine(target, inference, pick) : updateTargetLine(target);
    return (
        <div data-testid="addon-import-target" data-action={target.action} className={`p-3 rounded-lg border ${TONE[target.action]}`}>
            <p className="text-sm font-medium">{line}</p>
        </div>
    );
}
