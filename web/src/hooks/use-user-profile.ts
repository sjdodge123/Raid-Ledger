import { useQuery } from "@tanstack/react-query";
import {
  getUserProfile,
  getUserHeartedGames,
  getUserSteamLibrary,
  getUserEventSignups,
  getUserActivity,
} from "../lib/api-client";
import { useInfiniteList } from "./use-infinite-list";
import type {
  UserProfileDto,
  UserHeartedGamesResponseDto,
  UserEventSignupsResponseDto,
  ActivityPeriod,
  UserActivityResponseDto,
} from "@raid-ledger/contract";
import type { SteamLibraryResponseDto } from "@raid-ledger/contract";

const PREVIEW_LIMIT = 10;

/**
 * Fetch a user's public profile by ID (ROK-181).
 */
export function useUserProfile(userId: number | undefined) {
  return useQuery<UserProfileDto>({
    queryKey: ["userProfile", userId],
    queryFn: async () => {
      if (!userId) throw new Error("User ID required");
      return getUserProfile(userId);
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * ROK-745: Fetch first 10 hearted games for inline preview.
 */
export function useUserHeartedGames(userId: number | undefined) {
  return useQuery<UserHeartedGamesResponseDto>({
    queryKey: ["userHeartedGames", userId, "preview"],
    queryFn: async () => {
      if (!userId) throw new Error("User ID required");
      return getUserHeartedGames(userId, 1, PREVIEW_LIMIT);
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * ROK-745: Fetch full hearted games list (infinite scroll inside modal).
 */
export function useUserHeartedGamesModal(userId: number | undefined, enabled: boolean) {
  return useInfiniteList({
    queryKey: ["userHeartedGames", userId, "modal"],
    queryFn: async (page: number) => {
      if (!userId) throw new Error("User ID required");
      return getUserHeartedGames(userId, page, 20);
    },
    enabled: !!userId && enabled,
  });
}

/**
 * ROK-745: Fetch first 10 Steam library entries for inline preview.
 */
export function useUserSteamLibrary(userId: number | undefined) {
  return useQuery<SteamLibraryResponseDto>({
    queryKey: ["userSteamLibrary", userId, "preview"],
    queryFn: async () => {
      if (!userId) throw new Error("User ID required");
      return getUserSteamLibrary(userId, 1, PREVIEW_LIMIT);
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * ROK-745: Fetch full Steam library (infinite scroll inside modal).
 */
export function useUserSteamLibraryModal(userId: number | undefined, enabled: boolean) {
  return useInfiniteList({
    queryKey: ["userSteamLibrary", userId, "modal"],
    queryFn: async (page: number) => {
      if (!userId) throw new Error("User ID required");
      return getUserSteamLibrary(userId, page, 20);
    },
    enabled: !!userId && enabled,
  });
}

/**
 * ROK-299: Fetch upcoming events a user has signed up for.
 */
export function useUserEventSignups(userId: number | undefined) {
  return useQuery<UserEventSignupsResponseDto>({
    queryKey: ["userEventSignups", userId],
    queryFn: async () => {
      if (!userId) throw new Error("User ID required");
      return getUserEventSignups(userId);
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * ROK-443: Fetch a user's game activity (recently played games).
 */
export function useUserActivity(
  userId: number | undefined,
  period: ActivityPeriod,
) {
  return useQuery<UserActivityResponseDto>({
    queryKey: ["userActivity", userId, period],
    queryFn: async () => {
      if (!userId) throw new Error("User ID required");
      return getUserActivity(userId, period);
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
}
