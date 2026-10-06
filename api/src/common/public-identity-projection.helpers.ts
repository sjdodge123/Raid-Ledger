/**
 * Per-viewer projection of the user-identity read routes (ROK-1734).
 *
 * `GET /users`, `/users/recent`, `/users/:id/profile`, `/games/:id/activity`
 * and `/games/:id/now-playing`: signed-in, non-deactivated members keep
 * today's payload (same reference). Anonymous and deactivated viewers get the
 * row minus `discordId`, with `avatar` rebuilt server-side as an absolute
 * Discord CDN URL (or null) — the ROK-1629 rule applied by analogy.
 *
 * Applied at the HTTP boundary ONLY; services keep the full shape. Each
 * anonymous branch ends with the strict `Public*Schema.parse`, so a key added
 * to the service row without updating the public schema THROWS instead of
 * leaking (AC4). The public schemas check keys strictly and values loosely,
 * so the parse result is narrowed back to the DTO type its input guarantees.
 *
 * Viewer rule: callers pass `isMemberViewer(req.user)` from
 * `../events/roster-public-projection.helpers` — do not re-implement it.
 */
import {
  PublicPlayersListResponseSchema,
  PublicRecentPlayersResponseSchema,
  PublicUserProfileResponseSchema,
  PublicGameActivityResponseSchema,
  PublicGameNowPlayingResponseSchema,
} from '@raid-ledger/contract';
import type {
  PlayersListResponseDto,
  PublicPlayersListResponseDto,
  RecentPlayersResponseDto,
  PublicRecentPlayersResponseDto,
  UserProfileResponse,
  PublicUserProfileResponseDto,
  GameActivityResponseDto,
  PublicGameActivityResponseDto,
  GameNowPlayingResponseDto,
  PublicGameNowPlayingResponseDto,
} from '@raid-ledger/contract';
import { discordAvatarUrl } from './discord-avatar-url.helpers';

type IdentityRow = { discordId?: string | null; avatar: string | null };

/** Drop `discordId`; replace the raw avatar hash with a server-built absolute URL. */
export function toPublicIdentity<T extends IdentityRow>(
  row: T,
): Omit<T, 'discordId'> {
  const { discordId, ...rest } = row;
  return { ...rest, avatar: discordAvatarUrl(discordId, row.avatar) };
}

/** Strict-parse, then narrow back to the DTO type (values are checked loosely). */
function parseAs<T>(schema: { parse(v: unknown): unknown }, value: unknown): T {
  return schema.parse(value) as T;
}

export function projectPlayersList(
  payload: PlayersListResponseDto,
  isMember: boolean,
): PlayersListResponseDto | PublicPlayersListResponseDto {
  if (isMember) return payload;
  return parseAs(PublicPlayersListResponseSchema, {
    ...payload,
    data: payload.data.map(toPublicIdentity),
  });
}

export function projectRecentPlayers(
  payload: RecentPlayersResponseDto,
  isMember: boolean,
): RecentPlayersResponseDto | PublicRecentPlayersResponseDto {
  if (isMember) return payload;
  return parseAs(PublicRecentPlayersResponseSchema, {
    data: payload.data.map(toPublicIdentity),
  });
}

export function projectUserProfile(
  payload: UserProfileResponse,
  isMember: boolean,
): UserProfileResponse | PublicUserProfileResponseDto {
  if (isMember) return payload;
  return parseAs(PublicUserProfileResponseSchema, {
    data: toPublicIdentity(payload.data),
  });
}

export function projectGameActivity(
  payload: GameActivityResponseDto,
  isMember: boolean,
): GameActivityResponseDto | PublicGameActivityResponseDto {
  if (isMember) return payload;
  return parseAs(PublicGameActivityResponseSchema, {
    ...payload,
    topPlayers: payload.topPlayers.map(toPublicIdentity),
  });
}

export function projectNowPlaying(
  payload: GameNowPlayingResponseDto,
  isMember: boolean,
): GameNowPlayingResponseDto | PublicGameNowPlayingResponseDto {
  if (isMember) return payload;
  return parseAs(PublicGameNowPlayingResponseSchema, {
    ...payload,
    players: payload.players.map(toPublicIdentity),
  });
}
