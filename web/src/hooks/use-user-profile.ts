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
  UserEventSignupsResponseDto,
  ActivityPeriod,
  UserActivityResponseDto,
} from "@raid-ledger/contract";

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
 * ROK-282, ROK-754: Fetch games a user has hearted (paginated, infinite scroll).
 */
export function useUserHeartedGames(userId: number | undefined) {
  return useInfiniteList({
    queryKey: ["userHeartedGames", userId],
    queryFn: async (page: number) => {
      if (!userId) throw new Error("User ID required");
      return getUserHeartedGames(userId, page, 20);
    },
    enabled: !!userId,
  });
}

/**
 * ROK-754: Fetch a user's Steam library (paginated, infinite scroll).
 */
export function useUserSteamLibrary(userId: number | undefined) {
  return useInfiniteList({
    queryKey: ["userSteamLibrary", userId],
    queryFn: async (page: number) => {
      if (!userId) throw new Error("User ID required");
      return getUserSteamLibrary(userId, page, 20);
    },
    enabled: !!userId,
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
