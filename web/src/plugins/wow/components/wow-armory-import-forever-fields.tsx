/**
 * WoW: Forever branch of the Armory import form (ROK-1722). Forever is
 * realmless: the search takes a region, a ruleset and a two-part
 * "First Second" name through the shared ForeverIdentityFields, and both the
 * preview and the import send `realm: null` plus the picked ruleset.
 */
import type { JSX } from 'react';
import { WowForeverNameSchema, type WowForeverSelectableRuleset, type WowRegion } from '@raid-ledger/contract';
import { ForeverIdentityFields } from './forever-identity-fields';
import {
    FOREVER_NAME_REQUIRED, foreverCreateFields, validateForeverIdentity,
    type ForeverIdentity, type ForeverIdentityErrors,
} from '../lib/forever-identity';
import { normalizeWowVariant } from '../lib/wow-variant-config';

/** True when the Armory form searches the realmless WoW: Forever profile route. */
export function isForeverArmoryVariant(gameVariant: string | null | undefined): boolean {
    return !!gameVariant && normalizeWowVariant(gameVariant) === 'wow_forever';
}

/** What a Forever Armory search sends: no realm, the joined name and the picked ruleset. */
export interface ForeverArmoryTarget {
    name: string;
    realm: null;
    region: WowRegion;
    ruleset: WowForeverSelectableRuleset | null;
}

export type ForeverArmoryParse =
    | { ok: true; target: ForeverArmoryTarget }
    | { ok: false; errors: ForeverIdentityErrors };

/**
 * Validates the identity (each part, then the joined name against the contract's
 * WowForeverNameSchema) and maps it to the request target.
 */
export function parseForeverArmoryTarget(identity: ForeverIdentity): ForeverArmoryParse {
    const errors = validateForeverIdentity(identity);
    if (errors) return { ok: false, errors };
    const fields = foreverCreateFields(identity);
    if (!WowForeverNameSchema.safeParse(fields.name).success) return { ok: false, errors: { name: FOREVER_NAME_REQUIRED } };
    return { ok: true, target: { name: fields.name, realm: null, region: fields.region, ruleset: fields.ruleset ?? null } };
}

/** The Forever search inputs: region, ruleset, first + second name (no realm). */
export function WowArmoryImportForeverFields({ value, errors, onChange }: {
    value: ForeverIdentity; errors: ForeverIdentityErrors | null; onChange: (next: ForeverIdentity) => void;
}): JSX.Element {
    return <ForeverIdentityFields value={value} errors={errors ?? undefined} onChange={onChange} />;
}
