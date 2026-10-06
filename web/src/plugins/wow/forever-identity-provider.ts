/**
 * WoW: Forever character identity provider (ROK-1733): the plugin side of the
 * core `character-identity` hook. Every rule lives in `lib/forever-identity.ts`
 * (ROK-1721); this only adapts it to the provider shape core forms consume.
 */
import type { CharacterIdentityProvider } from '../character-identity';
import { ForeverIdentityFields } from './components/forever-identity-fields';
import {
    WOW_FOREVER_GAME_SLUG, emptyForeverIdentity, foreverCreateFields, foreverIdentityFromCharacter,
    foreverUpdateFields, formatForeverRuleset, sameForeverIdentity, validateForeverIdentity,
    type ForeverIdentity,
} from './lib/forever-identity';

export const foreverIdentityProvider: CharacterIdentityProvider<ForeverIdentity> = {
    gameSlugs: [WOW_FOREVER_GAME_SLUG],
    /** A Forever row saved before regions existed (region NULL) keeps the legacy Name + Realm fields. */
    appliesTo: (editing) => !editing || !!editing.region,
    empty: emptyForeverIdentity,
    fromCharacter: foreverIdentityFromCharacter,
    same: sameForeverIdentity,
    // Spread: ForeverIdentityErrors is an interface, which has no implicit index signature.
    validate: (v) => {
        const errs = validateForeverIdentity(v);
        return errs ? { ...errs } : null;
    },
    createFields: foreverCreateFields,
    updateFields: foreverUpdateFields,
    hidesRealm: true,
    Fields: ForeverIdentityFields,
    formatLocation: (c) => formatForeverRuleset(c.ruleset, c.region),
};
