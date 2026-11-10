/**
 * ROK-1717: the WoW Forever controls inside the Blizzard API integration card.
 *
 * Every admin sees the switches (Armory, quest import — ROK-2143 — and Wowhead
 * lookup), which apply immediately with the saved prefix (design-system: a
 * Switch is for settings that apply at once), and the quest-import status.
 * ROK-2163: the namespace diagnostics (status line, prefix override, probe
 * panel) render only on DEMO_MODE test/dev sites — see `forever-diagnostics`.
 */
import { useId, type JSX } from 'react';
import type { WowForeverConfigResponseDto } from '@raid-ledger/contract';
import { Switch } from '../../../components/ui/switch';
import { useForeverConfig } from '../hooks/use-forever-config';
import { ForeverDiagnostics } from './forever-diagnostics';
import { ForeverQuestImportPanel } from './forever-quest-import-panel';
import { save, savedDto, type SaveFn } from './forever-settings-save';

/** One setting that applies at once: label + hint on the left, a Switch on the right. */
interface SwitchRowProps {
    label: string;
    hint: string;
    checked: boolean;
    onChange: (next: boolean) => void;
    disabled: boolean;
}

function SwitchRow({ label, hint, ...sw }: SwitchRowProps): JSX.Element {
    const hintId = useId();
    return (
        <div className="flex items-center justify-between gap-4">
            <div>
                <p className="text-sm font-medium text-foreground">{label}</p>
                <p id={hintId} className="text-sm text-secondary">
                    {hint}
                </p>
            </div>
            <Switch {...sw} label={label} aria-describedby={hintId} />
        </div>
    );
}

function ArmoryToggle({
    saved,
    mutate,
    pending,
}: {
    saved: WowForeverConfigResponseDto;
    mutate: SaveFn;
    pending: boolean;
}): JSX.Element {
    const onChange = (next: boolean): void => {
        void save(
            mutate,
            savedDto(saved, { armoryImportEnabled: next }),
            next
                ? 'Armory import for WoW Forever turned on'
                : 'Armory import for WoW Forever turned off',
        );
    };
    return (
        <SwitchRow
            label="Armory import for WoW Forever"
            hint="On by default. Turn off to hide “Import from Armory” for Forever characters."
            checked={saved.armoryImportEnabled}
            onChange={onChange}
            disabled={pending}
        />
    );
}

function ResolverToggle({
    saved,
    mutate,
    pending,
}: {
    saved: WowForeverConfigResponseDto;
    mutate: SaveFn;
    pending: boolean;
}): JSX.Element {
    const onChange = (next: boolean): void => {
        void save(
            mutate,
            savedDto(saved, { wowheadResolverEnabled: next }),
            next
                ? 'Wowhead item lookup turned on'
                : 'Wowhead item lookup turned off',
        );
    };
    return (
        <SwitchRow
            label="Wowhead item lookup"
            hint="Fetch names and icons for addon-imported gear from Wowhead."
            checked={saved.wowheadResolverEnabled ?? true}
            onChange={onChange}
            disabled={pending}
        />
    );
}

/** ROK-2143: kill switch for the Blizzard quest import and its overlay (unset ⇒ ON). */
function QuestImportToggle({
    saved,
    mutate,
    pending,
}: {
    saved: WowForeverConfigResponseDto;
    mutate: SaveFn;
    pending: boolean;
}): JSX.Element {
    const onChange = (next: boolean): void => {
        void save(
            mutate,
            savedDto(saved, { questImportEnabled: next }),
            next
                ? 'Quest import from the Blizzard API turned on'
                : 'Quest import from the Blizzard API turned off',
        );
    };
    return (
        <SwitchRow
            label="Quest import from the Blizzard API"
            hint="On by default. Turn off to stop the import and show the bundled quest data in Quest Prep."
            checked={saved.questImportEnabled ?? true}
            onChange={onChange}
            disabled={pending}
        />
    );
}

/** The admin "WoW Forever" section; renders nothing until the saved config has loaded. */
export function ForeverSettingsSection(): JSX.Element | null {
    const { config, update } = useForeverConfig();
    if (!config.data) return null;
    return (
        <section
            aria-labelledby="wow-forever-settings-heading"
            className="mt-6 pt-6 border-t border-edge space-y-4"
        >
            <h3
                id="wow-forever-settings-heading"
                className="text-base font-semibold text-foreground"
            >
                WoW Forever
            </h3>
            <ArmoryToggle
                saved={config.data}
                mutate={update.mutateAsync}
                pending={update.isPending}
            />
            <QuestImportToggle
                saved={config.data}
                mutate={update.mutateAsync}
                pending={update.isPending}
            />
            <ResolverToggle
                saved={config.data}
                mutate={update.mutateAsync}
                pending={update.isPending}
            />
            <ForeverDiagnostics
                saved={config.data}
                mutate={update.mutateAsync}
                pending={update.isPending}
            />
            <ForeverQuestImportPanel />
        </section>
    );
}
