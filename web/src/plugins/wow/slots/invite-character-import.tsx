/**
 * ROK-2357 — the WoW armory import on the invite page's character step
 * (`invite:character-import`). Mounted only while `blizzard` is active, so the
 * core invite page no longer ships or shows the form with WoW off.
 */
import type { JSX } from 'react';
import { WowArmoryImportForm } from '../components/wow-armory-import-form';

export interface InviteCharacterImportProps {
    gameVariant?: string | undefined;
    defaultRealm?: string | undefined;
    onSuccess?: (() => void) | undefined;
}

export function InviteCharacterImport({ gameVariant, defaultRealm, onSuccess }: InviteCharacterImportProps): JSX.Element {
    return <WowArmoryImportForm gameVariant={gameVariant} defaultRealm={defaultRealm} {...(onSuccess ? { onSuccess } : {})} isMain />;
}
