import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PluginRegistryService } from './plugin-registry.service';

export const PLUGIN_SLUG_KEY = 'pluginSlug';
export const RequirePlugin = (slug: string) =>
  SetMetadata(PLUGIN_SLUG_KEY, slug);

@Injectable()
export class PluginActiveGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private pluginRegistry: PluginRegistryService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const slug = this.reflector.getAllAndOverride<string>(PLUGIN_SLUG_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!slug) return true;

    if (!this.pluginRegistry.getActiveSlugsSync().has(slug)) {
      throw new ForbiddenException(`Plugin "${slug}" is not active`);
    }

    return true;
  }
}
