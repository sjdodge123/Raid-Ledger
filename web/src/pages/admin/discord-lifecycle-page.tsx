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

function PageHeader(): JSX.Element {
    return (
        <div>
            <h2 className="text-xl font-semibold text-foreground">Channel automation</h2>
            <p className="text-sm text-muted mt-1">Raid Ledger creates a text channel for each active game and archives it when the game goes quiet.</p>
        </div>
    );
}

/** The channel-lifecycle admin page. */
export function DiscordLifecyclePage(): JSX.Element {
    const settings = useLifecycleSettings();
    const update = useUpdateLifecycleSettings();
    const bot = useLifecycleBotOnline();
    const categories = useLifecycleCategories();
    const activity = useLifecycleActivity();
    const suppressions = useLifecycleSuppressions();
    const save = (patch: UpdateChannelLifecycleSettingsDto): void =>
        update.mutate(patch, { onSuccess: () => toast.success('Channel automation updated') });
    if (!settings.data) {
        return <div className="space-y-6"><PageHeader /><p className="text-sm text-muted">{settings.isError ? 'Couldn’t load the settings.' : 'Loading…'}</p></div>;
    }
    const s = settings.data;
    return (
        <div className="space-y-6">
            <PageHeader />
            <AutomationSection settings={s} onSave={save} botOnline={bot.online} pending={update.isPending || bot.loading}
                error={update.error?.message} />
            <CategoriesSection settings={s} onSave={save} categories={categories.data ?? []} />
            <ThresholdsSection settings={s} onSave={save} />
            <ActivitySection items={activity.data?.items ?? []} windowDays={activity.data?.windowDays ?? s.recentActivityDays} />
            <SuppressionsSection items={suppressions.data?.items ?? []} />
            <RunSection lastRunAt={s.lastRunAt} lastRunError={s.lastRunError} />
        </div>
    );
}
