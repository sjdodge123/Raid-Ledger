import { z } from 'zod';

/**
 * ROK-2371: sign-in identities (Sign in with Google).
 *
 * Google identities are keyed by the provider `sub` server-side; neither the
 * subject nor (for the pending view) the email ever leaves the server here.
 */

/** Providers a user can sign in with via an external identity. */
export const SigninProviderSchema = z.enum(['discord', 'google']);
export type SigninProvider = z.infer<typeof SigninProviderSchema>;

/** The linked Google identity, as shown on the owner's Profile. */
export const LinkedGoogleIdentitySchema = z
  .object({
    /** Display only — never a lookup key (ruling 1: no auto-link by email). */
    email: z.string().nullable(),
    linkedAt: z.string().datetime(),
  })
  .strict();
export type LinkedGoogleIdentityDto = z.infer<typeof LinkedGoogleIdentitySchema>;

/**
 * Every way the signed-in user can sign in. Served as the optional
 * `signinMethods` field of the owner-only `GET /auth/me` response; drives the
 * Profile link panel and the "last way to sign in" unlink guard.
 */
export const SigninMethodsSchema = z
  .object({
    discord: z.boolean(),
    google: LinkedGoogleIdentitySchema.nullable(),
    password: z.boolean(),
  })
  .strict();
export type SigninMethodsDto = z.infer<typeof SigninMethodsSchema>;

/**
 * `GET /auth/first-time` (D1a "First time here?" screen): the identity that
 * just authenticated but matches no account. No subject, no email.
 */
export const PendingIdentityViewSchema = z
  .object({
    provider: SigninProviderSchema,
    displayName: z.string(),
    /** The provider to offer for "I already have an account". */
    otherMethod: SigninProviderSchema,
  })
  .strict();
export type PendingIdentityViewDto = z.infer<typeof PendingIdentityViewSchema>;
