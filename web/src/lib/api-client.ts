/**
 * API Client barrel -- re-exports all domain API modules.
 * Import from here for backward compatibility.
 */

// Core
export { fetchApi } from './api/fetch-api';

// Avatar
export {
    uploadAvatar,
    deleteCustomAvatar,
    adminRemoveAvatar,
} from './api/avatar-api';

// Events, Signups, Attendance, Roster
export type { EventListParams, RosterAvailabilityParams } from './api/events-api';
export {
    getEvents,
    getEvent,
    getEventRoster,
    getEventVariantContext,
    createEvent,
    updateEvent,
    cancelEvent,
    deleteEvent,
    getMyDashboard,
    signupForEvent,
    cancelSignup,
    confirmSignup,
    updateSignupStatus,
    redeemIntent,
    recordAttendance,
    getAttendanceSummary,
    getRosterWithAssignments,
    updateRoster,
    selfUnassignFromRoster,
    adminRemoveUserFromEvent,
    getRosterAvailability,
    getAggregateGameTime,
    rescheduleEvent,
} from './api/events-api';

// Games
export {
    searchGames,
    fetchGameRegistry,
    getGameEventTypes,
    getGameActivity,
    getGameNowPlaying,
    getGamePricing,
    getGamePricingBatch,
} from './api/games-api';

// Characters
export {
    getMyCharacters,
    createCharacter,
    updateCharacter,
    setMainCharacter,
    deleteCharacter,
    getUserCharacters,
    getCharacterDetail,
} from './api/characters-api';

// Availability
export type { AvailabilityQueryParams } from './api/availability-api';
export {
    getMyAvailability,
    createAvailability,
    updateAvailability,
    deleteAvailability,
} from './api/availability-api';

// Users, Management, Discord link
export {
    getPlayers,
    getRecentPlayers,
    getUserProfile,
    getUserHeartedGames,
    getUserSteamLibrary,
    getUserSteamWishlist,
    getUserEventSignups,
    getUserActivity,
    getUsersForManagement,
    updateUserRole,
    deleteMyAccount,
    adminRemoveUser,
    unlinkDiscord,
} from './api/users-api';

// Preferences
export {
    getMyPreferences,
    updatePreference,
} from './api/preferences-api';

// Game Time
export {
    getMyGameTime,
    saveMyGameTime,
    saveMyGameTimeOverrides,
    createGameTimeAbsence,
    deleteGameTimeAbsence,
    getGameTimeAbsences,
} from './api/game-time-api';

// Event Templates
export {
    getEventTemplates,
    createEventTemplate,
    deleteEventTemplate,
} from './api/templates-api';

// Plugin Admin
export {
    getPlugins,
    installPlugin,
    uninstallPlugin,
    activatePlugin,
    deactivatePlugin,
} from './api/plugins-api';

// Discord / PUGs / Invite Codes
export type { DiscordMemberSearchResult } from './api/discord-api';
export {
    getEventPugs,
    createPugSlot,
    updatePugSlot,
    deletePugSlot,
    inviteMember,
    listDiscordMembers,
    searchDiscordMembers,
    resolveInviteCode,
    claimInviteCode,
    shareEventToDiscord,
    regeneratePugInviteCode,
} from './api/discord-api';

// Event Plans
export {
    getTimeSuggestions,
    createEventPlan,
    getMyEventPlans,
    getEventPlan,
    cancelEventPlan,
    getEventPlanPollResults,
    restartEventPlan,
    convertEventToPlan,
} from './api/event-plans-api';

// Event Series (ROK-429)
export {
    updateSeries,
    deleteSeries,
    cancelSeries,
} from './api/event-series-api';

// Analytics
export {
    getAttendanceTrends,
    getUserReliability,
    getGameAttendance,
    getEventMetrics,
} from './api/analytics-api';

// Lineups (ROK-934, ROK-935)
export type { CommonGroundParams, CreateLineupParams } from './api/lineups-api';
export {
    getActiveLineup,
    getCommonGround,
    nominateGame,
    getLineupBanner,
    getLineupById,
    removeNomination,
    createLineup,
    transitionLineupStatus,
} from './api/lineups-api';

// Activity Log (ROK-930)
export {
    getLineupActivity,
    getEventActivity,
} from './api/activity-log-api';
