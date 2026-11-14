// The SHARED (community-wide) app_settings keys that the VM settings bundle
// carries. Deny-by-default: anything not listed never enters the bundle.
// Its own module (no side effects) so both rl-settings-bundle.mjs and
// rl-reencrypt-settings.mjs (ROK-2202) read ONE list.

/** Community-wide API keys — safe to share across every fleet env. */
export const SHARED_KEYS = [
    'itad_api_key',
    'steam_api_key',
    'cooptimus_user_agent',
    'cooptimus_prose_enabled',
    'blizzard_client_id',
    'blizzard_client_secret',
    'igdb_client_id',
    'igdb_client_secret',
    'igdb_filter_adult',
    'ai_provider',
    'ai_model',
    'ai_ollama_url',
    'ai_chat_enabled',
    'ai_openai_api_key',
    'ai_claude_api_key',
    'ai_google_api_key',
];
