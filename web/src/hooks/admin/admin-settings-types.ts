/**
 * Shared types for admin settings hooks.
 * TODO(ROK-560): Move local interfaces to @raid-ledger/contract.
 */

export interface OAuthStatusResponse {
    configured: boolean;
    callbackUrl: string | null;
}

export interface OAuthConfigDto {
    clientId: string;
    clientSecret: string;
    callbackUrl: string;
}

export interface OAuthTestResponse {
    success: boolean;
    message: string;
}

export interface IgdbHealthStatus {
    tokenStatus: 'valid' | 'expired' | 'not_fetched';
    tokenExpiresAt: string | null;
    lastApiCallAt: string | null;
    lastApiCallSuccess: boolean | null;
}

export interface IgdbSyncStatus {
    lastSyncAt: string | null;
    gameCount: number;
    syncInProgress: boolean;
}

export interface IgdbStatusResponse {
    configured: boolean;
    health?: IgdbHealthStatus;
}

export interface IgdbConfigDto {
    clientId: string;
    clientSecret: string;
}

export interface BlizzardStatusResponse {
    configured: boolean;
}

export interface BlizzardConfigDto {
    clientId: string;
    clientSecret: string;
}

export interface DiscordBotPermissionsResult {
    allGranted: boolean;
    permissions: { name: string; granted: boolean }[];
}

export interface ApiResponse {
    success: boolean;
    message: string;
}

export interface DemoDataCounts {
    users: number;
    events: number;
    characters: number;
    signups: number;
    availability: number;
    gameTimeSlots: number;
    notifications: number;
}

export interface DemoDataStatus extends DemoDataCounts {
    demoMode: boolean;
}

export interface DemoDataResult {
    success: boolean;
    message: string;
    counts: DemoDataCounts;
}

/**
 * ROK-1471: bot invite URL + the required-permission list, served by the API so
 * the admin UI never hardcodes (and never drifts from) the real permission set.
 * `url` is null until a Discord application client id has been saved.
 */
export interface BotInviteInfo {
    url: string | null;
    permissions: string[];
    clientId: string | null;
}

/**
 * ROK-1471: LFG forum-board feature toggle. A `warning` on a PUT response means
 * the toggle WAS persisted but the bot is missing the named guild permissions.
 */
export interface LfgBoardSettings {
    enabled: boolean;
    /**
     * Forum channel the board listener created, or null while it is still
     * being created (the listener runs asynchronously off the toggle). Absent
     * on the PUT echo, which answers before the channel exists.
     */
    channelId?: string | null;
    warning?: { missing: string[] };
}
