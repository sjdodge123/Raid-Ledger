/**
 * ROK-1717: the WoW Forever controls inside the Blizzard API integration card.
 *
 * The Forever namespace prefix is known (`forever`, confirmed by the ROK-2102
 * probe), so the prefix field is an override only. A one-line status reads the
 * latest probe result to say whether the configured prefix is confirmed live.
 * The prefix is a form field saved with its button; the switches (Armory,
 * quest import — ROK-2143 — and Wowhead lookup) apply
 * immediately with the saved prefix (design-system: a Switch is for settings
 * that apply at once).
 */
import { useId, useState, type FormEvent, type JSX } from 'react';
import {
    WowForeverNamespacePrefixSchema,
    type WowForeverConfigResponseDto,
} from '@raid-ledger/contract';
import { toast } from '../../../lib/toast';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Input } from '../../../components/ui/input';
import { Switch } from '../../../components/ui/switch';
import { useForeverConfig } from '../hooks/use-forever-config';
import { useForeverProbe } from '../hooks/use-forever-probe';
import { ForeverProbePanel } from './forever-probe-panel';
import { ForeverQuestImportPanel } from './forever-quest-import-panel';

type SaveFn = ReturnType<typeof useForeverConfig>['update']['mutateAsync'];
type SaveDto = Parameters<SaveFn>[0];

/** The saved config as a PUT body, so one switch never resets another setting. */
function savedDto(
    saved: WowForeverConfigResponseDto,
    patch: Partial<SaveDto>,
): SaveDto {
    const dto: SaveDto = {
        namespacePrefix: saved.namespacePrefix,
        armoryImportEnabled: saved.armoryImportEnabled,
        ...(saved.wowheadResolverEnabled !== undefined && {
            wowheadResolverEnabled: saved.wowheadResolverEnabled,
        }),
        ...(saved.questImportEnabled !== undefined && {
            questImportEnabled: saved.questImportEnabled,
        }),
        ...patch,
    };
    return dto;
}

async function save(
    mutate: SaveFn,
    dto: SaveDto,
    success: string,
): Promise<void> {
    try {
        await mutate(dto);
        toast.success(success);
    } catch (err) {
        toast.error(
            err instanceof Error
                ? err.message
                : 'Failed to save WoW Forever settings',
        );
    }
}

function PrefixForm({
    saved,
    mutate,
    pending,
}: {
    saved: WowForeverConfigResponseDto;
    mutate: SaveFn;
    pending: boolean;
}): JSX.Element {
    const [prefix, setPrefix] = useState(saved.namespacePrefix);
    const [error, setError] = useState<string | undefined>();
    const onSubmit = (e: FormEvent): void => {
        e.preventDefault();
        const parsed = WowForeverNamespacePrefixSchema.safeParse(prefix);
        if (!parsed.success) {
            setError(parsed.error.issues[0]?.message ?? 'Invalid prefix');
            return;
        }
        setError(undefined);
        void save(
            mutate,
            savedDto(saved, { namespacePrefix: parsed.data }),
            'WoW Forever namespace saved',
        );
    };
    return (
        <form onSubmit={onSubmit} noValidate className="space-y-3">
            <Field
                label="Namespace prefix"
                error={error}
                hint="Blizzard namespace without the static-/dynamic-/profile- part and region"
            >
                <Input
                    type="text"
                    value={prefix}
                    onChange={(e) => setPrefix(e.target.value)}
                    placeholder="forever"
                    fieldSize="lg"
                />
            </Field>
            <Button
                type="submit"
                variant="secondary"
                loading={pending}
                loadingLabel="Saving..."
                aria-label="Save Forever settings"
            >
                Save
            </Button>
        </form>
    );
}

/** One-line status: is the configured prefix a match in the latest probe run? (ROK-2102) */
function NamespaceStatus({ prefix }: { prefix: string }): JSX.Element | null {
    const { probe } = useForeverProbe();
    if (probe.isPending) return null;
    const live =
        probe.data?.result?.matches.some((m) => m.prefix === prefix) ?? false;
    if (live) {
        return (
            <p className="text-sm text-secondary">
                Forever namespace: <span className="text-foreground">live</span>{' '}
                — prefix <code>{prefix}</code>
            </p>
        );
    }
    return (
        <p className="text-sm text-secondary">
            Forever namespace:{' '}
            <span className="text-foreground">not confirmed</span> — prefix{' '}
            <code>{prefix}</code>. Run the probe below.
        </p>
    );
}

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
            <NamespaceStatus prefix={config.data.namespacePrefix} />
            <PrefixForm
                key={config.data.namespacePrefix}
                saved={config.data}
                mutate={update.mutateAsync}
                pending={update.isPending}
            />
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
            <ForeverProbePanel />
            <ForeverQuestImportPanel />
        </section>
    );
}
