/**
 * ROK-1428 (L7, ROK-1433) — `/admin/settings/discord/lifecycle`: game-channel
 * automation settings, the activity preview, suppressions and the run
 * controls (spec §3.1). Sections live in `discord-lifecycle-*.tsx`.
 */
import type { JSX } from 'react';
import type { UpdateChannelLifecycleSettingsDto } from '@raid-ledger/contract';
import { toast } from '../../lib/toast';
import {
    useLifecycleActivity, useLifecycleBotOnline, useLifecycleCategories, useLifecycleSettings,
    useLifecycleSuppressions, useUpdateLifecycleSettings,
} from '../../hooks/admin/use-channel-lifecycle';
import { AutomationSection, CategoriesSection, ThresholdsSection } from './discord-lifecycle-settings';
import { ActivitySection, SuppressionsSection } from './discord-lifecycle-activity';
import { RunSection } from './discord-lifecycle-run';
import { SECTION_KEYS, loadState, sectionError } from './discord-lifecycle.helpers';

function PageHeader(): JSX.Element {
    return (
        <div>
            <h2 className="text-xl font-semibold text-foreground">Channel automation</h2>
            <p className="text-sm text-muted mt-1">Raid Ledger creates a text channel for each active game and archives it when the game goes quiet.</p>
        </div>
    );
}

/** The settings PATCH plus its error routed to the section whose key failed. */
function useSettingsSave(): {
    save: (patch: UpdateChannelLifecycleSettingsDto) => void; pending: boolean; resetKey: number;
    errorFor: (section: keyof typeof SECTION_KEYS) => string | undefined;
} {
    const update = useUpdateLifecycleSettings();
    return {
        save: (patch) => update.mutate(patch, { onSuccess: () => toast.success('Channel automation updated') }),
        pending: update.isPending,
        resetKey: update.isError ? update.submittedAt : 0,
        errorFor: (section) => sectionError(update.error, update.variables, SECTION_KEYS[section]),
    };
}

/** The Preview + Not-recreated sections with their own loading / error states. */
function PreviewSections({ fallbackDays }: { fallbackDays: number }): JSX.Element {
    const activity = useLifecycleActivity();
    const suppressions = useLifecycleSuppressions();
    return (
        <>
            <ActivitySection items={activity.data?.items ?? []} windowDays={activity.data?.windowDays ?? fallbackDays}
                state={loadState(activity)} onRetry={() => void activity.refetch()} />
            <SuppressionsSection items={suppressions.data?.items ?? []} state={loadState(suppressions)}
                onRetry={() => void suppressions.refetch()} />
        </>
    );
}

/** The channel-lifecycle admin page. */
export function DiscordLifecyclePage(): JSX.Element {
    const settings = useLifecycleSettings();
    const { save, pending, resetKey, errorFor } = useSettingsSave();
    const bot = useLifecycleBotOnline();
    const categories = useLifecycleCategories();
    if (!settings.data) {
        return <div className="space-y-6"><PageHeader /><p className="text-sm text-muted">{settings.isError ? 'Couldn’t load the settings.' : 'Loading…'}</p></div>;
    }
    const s = settings.data;
    return (
        <div className="space-y-6">
            <PageHeader />
            <AutomationSection settings={s} onSave={save} botOnline={bot.online} pending={pending || bot.loading} error={errorFor('automation')} />
            <CategoriesSection settings={s} onSave={save} error={errorFor('categories')} categories={categories.data ?? []}
                categoriesState={loadState(categories)} onRetryCategories={() => void categories.refetch()} />
            <ThresholdsSection settings={s} onSave={save} error={errorFor('thresholds')} resetKey={resetKey} />
            <PreviewSections fallbackDays={s.recentActivityDays} />
            <RunSection lastRunAt={s.lastRunAt} lastRunError={s.lastRunError} />
        </div>
    );
}
