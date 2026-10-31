import { useState } from 'react';
import { useOAuthSettings } from '../../../../hooks/admin/use-oauth-settings';
import { useDiscordBotSettings } from '../../../../hooks/admin/use-discord-bot-settings';
import { buildCallbackUrl } from '../../discord-shared/callback-urls';

export interface KeysInput { appId: string; secret: string; token: string }

/**
 * 4c Continue (D-4/AC-7): save OAuth, then the bot token. The ID + secret
 * pair was already confirmed live (`usePairCheck`), so nothing is re-tested.
 */
export function useKeysSave(onSaved: () => void) {
    const { updateOAuth } = useOAuthSettings();
    const { updateDiscordBot } = useDiscordBotSettings();
    const [saveError, setSaveError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const save = async ({ appId, secret, token }: KeysInput): Promise<void> => {
        setSaving(true); setSaveError(null);
        try {
            const saved = await updateOAuth.mutateAsync({ clientId: appId.trim(), clientSecret: secret.trim(), callbackUrl: buildCallbackUrl() });
            if (!saved.success) { setSaveError(saved.message); return; }
            const bot = await updateDiscordBot.mutateAsync({ botToken: token.trim(), enabled: true });
            if (!bot.success) { setSaveError(bot.message); return; }
            onSaved();
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : 'Could not save. Try again.');
        } finally {
            setSaving(false);
        }
    };

    return { save, saving, saveError };
}
