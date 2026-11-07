/**
 * WoW: Forever Armory search target (ROK-1722): Forever is realmless, so a
 * search takes a region, a ruleset and a two-part "First Second" name, and
 * both the preview and the import send `realm: null` plus the picked ruleset.
 */
import { WowForeverNameSchema, type WowForeverSelectableRuleset, type WowRegion } from '@raid-ledger/contract';
import {
    FOREVER_NAME_REQUIRED, foreverCreateFields, validateForeverIdentity,
    type ForeverIdentity, type ForeverIdentityErrors,
} from './forever-identity';
import { normalizeWowVariant } from './wow-variant-config';

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
