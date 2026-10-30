import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { isCloudFlavour } from './flavour';

/**
 * ROK-1700 — a route that does not exist on a cloud instance. Under
 * `RL_FLAVOUR=cloud` it answers 404 (not 403: the surface is absent, not
 * forbidden). List it FIRST in `@UseGuards` so even an unauthenticated probe
 * gets the 404. NAS / unset → always passes.
 */
@Injectable()
export class NasOnlyGuard implements CanActivate {
  canActivate(): boolean {
    if (isCloudFlavour()) throw new NotFoundException();
    return true;
  }
}
