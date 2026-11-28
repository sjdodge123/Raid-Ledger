/**
 * ROK-2371: the Google login method on `EXTENSION_POINTS.AUTH_PROVIDER`,
 * owned by the built-in Core plugin (spec §5: not a hub behaviour; Core is
 * always on). Listed only while the admin toggle is on and the client is set.
 */
import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  EXTENSION_POINTS,
  type AuthProvider,
  type LoginMethod,
} from '../../plugins/plugin-host/extension-points';
import { PluginRegistryService } from '../../plugins/plugin-host/plugin-registry.service';
import { GoogleSigninService } from './google-signin.service';

/** Registry key (the owning plugin id) for the Google auth provider. */
export const GOOGLE_AUTH_PROVIDER_OWNER = 'core';

@Injectable()
export class GoogleAuthProviderAdapter implements AuthProvider, OnModuleInit {
  readonly providerKey = 'google';

  constructor(
    private readonly registry: PluginRegistryService,
    private readonly svc: GoogleSigninService,
  ) {}

  onModuleInit(): void {
    this.registry.registerAdapter(
      EXTENSION_POINTS.AUTH_PROVIDER,
      GOOGLE_AUTH_PROVIDER_OWNER,
      this,
    );
  }

  getLoginMethod(): LoginMethod {
    return {
      key: 'google',
      label: 'Sign in with Google',
      icon: 'google',
      loginPath: '/auth/google',
      placement: 'primary',
    };
  }

  isConfigured(): Promise<boolean> {
    return this.svc.isEnabled();
  }
}
