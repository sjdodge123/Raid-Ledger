import { isDiscordLinked, buildDiscordAvatarUrl } from '../../lib/avatar';
import type { AvatarType } from '../../lib/avatar';
import { API_BASE_URL } from '../../lib/config';

/** Build available avatar options from user data and characters */
export function buildAvatarOptions(
    user: { discordId: string | null; avatar: string | null; customAvatarUrl: string | null },
    characters: { avatarUrl: string | null; name: string }[],
): { url: string; label: string; type: AvatarType; characterName?: string }[] {
    const options: { url: string; label: string; type: AvatarType; characterName?: string }[] = [];
    if (user.customAvatarUrl) {
        options.push({ url: `${API_BASE_URL}${user.customAvatarUrl}`, label: 'Custom', type: 'custom' });
    }
    const hasDiscordLinked = isDiscordLinked(user.discordId);
    const discordUrl = buildDiscordAvatarUrl(user.discordId, user.avatar);
    if (hasDiscordLinked && discordUrl) {
        options.push({ url: discordUrl, label: 'Discord', type: 'discord' });
    }
    for (const char of characters) {
        if (char.avatarUrl) {
            options.push({ url: char.avatarUrl, label: char.name, type: 'character', characterName: char.name });
        }
    }
    return options;
}
