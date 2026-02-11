import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PluginActiveGuard, PLUGIN_SLUG_KEY } from './plugin-active.guard';
import { PluginRegistryService } from './plugin-registry.service';

describe('PluginActiveGuard', () => {
  let guard: PluginActiveGuard;
  let reflector: Reflector;
  let registry: { getActiveSlugsSync: jest.Mock };

  beforeEach(() => {
    reflector = new Reflector();
    registry = {
      getActiveSlugsSync: jest.fn().mockReturnValue(new Set(['active-plugin'])),
    };
    guard = new PluginActiveGuard(
      reflector,
      registry as unknown as PluginRegistryService,
    );
  });

  function createMockContext(
    handler = jest.fn(),
    cls = jest.fn(),
  ): ExecutionContext {
    return {
      getHandler: () => handler,
      getClass: () => cls,
      switchToHttp: jest.fn(),
      switchToRpc: jest.fn(),
      switchToWs: jest.fn(),
      getType: jest.fn(),
      getArgs: jest.fn(),
      getArgByIndex: jest.fn(),
    } as unknown as ExecutionContext;
  }

  it('should allow access when no plugin slug metadata is set', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const context = createMockContext();

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow access when plugin is active', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('active-plugin');
    const context = createMockContext();

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should throw ForbiddenException when plugin is inactive', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue('inactive-plugin');
    const context = createMockContext();

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(context)).toThrow(
      'Plugin "inactive-plugin" is not active',
    );
  });

  it('should use PLUGIN_SLUG_KEY for metadata lookup', () => {
    const spy = jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(undefined);
    const context = createMockContext();

    guard.canActivate(context);

    expect(spy).toHaveBeenCalledWith(PLUGIN_SLUG_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
  });
});
