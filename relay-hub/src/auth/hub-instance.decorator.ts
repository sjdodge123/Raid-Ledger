import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { HubAuth, HubAuthedRequest } from './bearer.guard';

/** The instance {@link HubBearerGuard} authenticated; only valid behind it. */
export const HubInstance = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): HubAuth => {
    const auth = ctx.switchToHttp().getRequest<HubAuthedRequest>().hubInstance;
    if (!auth) throw new Error('HubInstance used without HubBearerGuard');
    return auth;
  },
);
