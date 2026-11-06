/**
 * WoW: Forever branch of the Armory import form (ROK-1722). Forever is
 * realmless: the search takes a region, a ruleset and a two-part
 * "First Second" name through the shared ForeverIdentityFields. The request
 * mapping lives in lib/forever-armory-target.ts.
 */
import type { JSX } from 'react';
import { ForeverIdentityFields } from './forever-identity-fields';
import type { ForeverIdentity, ForeverIdentityErrors } from '../lib/forever-identity';

/** The Forever search inputs: region, ruleset, first + second name (no realm). */
export function WowArmoryImportForeverFields({ value, errors, onChange }: {
    value: ForeverIdentity; errors: ForeverIdentityErrors | null; onChange: (next: ForeverIdentity) => void;
}): JSX.Element {
    return <ForeverIdentityFields value={value} errors={errors ?? undefined} onChange={onChange} />;
}
