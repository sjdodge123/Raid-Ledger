import { z } from 'zod';
import {
    UserPreviewSchema,
    PlayersListResponseSchema,
    RecentPlayerSchema,
    UserProfileSchema,
    type UserPreviewDto,
    type PlayersListResponseDto,
    type RecentPlayerDto,
    type UserProfileDto,
} from './users.schema.js';
import { CharacterSchema } from './characters.schema.js';
import {
    GameTopPlayerSchema,
    GameActivityResponseSchema,
    NowPlayingPlayerSchema,
    GameNowPlayingResponseSchema,
    type GameTopPlayerDto,
    type GameActivityResponseDto,
    type NowPlayingPlayerDto,
} from './games.schema.js';

// ============================================================
// Public (anonymous-viewer) identity projections (ROK-1734)
//
// `GET /users`, `/users/recent`, `/users/:id/profile`, `/games/:id/activity`
// and `/games/:id/now-playing` send anonymous / deactivated viewers display
// name + `customAvatarUrl` + a SERVER-BUILT avatar URL — no `discordId`.
// Same rule as the ROK-1629 roster projections (`roster-public.schema.ts`):
// every shape is DERIVED from the member shape (`.omit` / `.extend`) and
// identity-bearing objects are `.strict()`, so a new key fails the API-side
// parse instead of leaking. KEYS are checked strictly, VALUES loosely (a
// datetime / uuid / url the member schema would reject must not 500 a public
// route). Exported TS types stay derived from the member DTOs.
//
// `avatar` on every public shape is an absolute URL or null (server-built).
// ============================================================

/** Character with every member key allowed (strict) but values unchecked. */
const PublicCharacterKeysSchema = z
    .object(
        Object.fromEntries(
            Object.keys(CharacterSchema.shape).map((k) => [k, z.unknown()]),
        ),
    )
    .strict();

/** `GET /users` row for anonymous viewers. Keeps `steamLinked` (Q3). */
export const PublicUserPreviewSchema = UserPreviewSchema.omit({
    discordId: true,
}).strict();
export type PublicUserPreviewDto = Omit<UserPreviewDto, 'discordId'>;

export const PublicPlayersListResponseSchema = PlayersListResponseSchema.extend({
    data: z.array(PublicUserPreviewSchema),
}).strict();
export type PublicPlayersListResponseDto = Omit<PlayersListResponseDto, 'data'> & {
    data: PublicUserPreviewDto[];
};

/** `GET /users/recent` row for anonymous viewers. */
export const PublicRecentPlayerSchema = RecentPlayerSchema.omit({
    discordId: true,
})
    .extend({ createdAt: z.string() })
    .strict();
export type PublicRecentPlayerDto = Omit<RecentPlayerDto, 'discordId'>;

export const PublicRecentPlayersResponseSchema = z
    .object({ data: z.array(PublicRecentPlayerSchema) })
    .strict();
export type PublicRecentPlayersResponseDto = { data: PublicRecentPlayerDto[] };

/** `GET /users/:id/profile` for anonymous viewers (`steamId` is owner-only — Q1). */
export const PublicUserProfileSchema = UserProfileSchema.omit({
    discordId: true,
})
    .extend({
        role: z.string().optional(),
        onboardingCompletedAt: z.string().nullable().optional(),
        createdAt: z.string(),
        characters: z.array(PublicCharacterKeysSchema),
    })
    .strict();
export type PublicUserProfileDto = Omit<UserProfileDto, 'discordId'>;

export const PublicUserProfileResponseSchema = z
    .object({ data: PublicUserProfileSchema })
    .strict();
export type PublicUserProfileResponseDto = { data: PublicUserProfileDto };

/** `GET /games/:id/activity` top player for anonymous viewers. */
export const PublicGameTopPlayerSchema = GameTopPlayerSchema.omit({
    discordId: true,
}).strict();
export type PublicGameTopPlayerDto = Omit<GameTopPlayerDto, 'discordId'>;

export const PublicGameActivityResponseSchema = GameActivityResponseSchema.extend({
    topPlayers: z.array(PublicGameTopPlayerSchema),
    period: z.string(),
}).strict();
export type PublicGameActivityResponseDto = Omit<
    GameActivityResponseDto,
    'topPlayers'
> & { topPlayers: PublicGameTopPlayerDto[] };

/** `GET /games/:id/now-playing` player for anonymous viewers. */
export const PublicNowPlayingPlayerSchema = NowPlayingPlayerSchema.omit({
    discordId: true,
}).strict();
export type PublicNowPlayingPlayerDto = Omit<NowPlayingPlayerDto, 'discordId'>;

export const PublicGameNowPlayingResponseSchema = GameNowPlayingResponseSchema.extend({
    players: z.array(PublicNowPlayingPlayerSchema),
}).strict();
export type PublicGameNowPlayingResponseDto = {
    players: PublicNowPlayingPlayerDto[];
    count: number;
};
