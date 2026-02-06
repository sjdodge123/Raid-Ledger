/**
 * API URL constants (Fix #5: remove hardcoded URLs from components)
 */
export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
export const AUTH_DISCORD_URL = `${API_BASE_URL}/auth/discord`;
