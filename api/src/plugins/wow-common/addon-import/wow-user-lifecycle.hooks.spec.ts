/**
 * ROK-2364 review MINOR-1 — the wow USER_LIFECYCLE hooks must exist as soon as
 * the registrar is CONSTRUCTED. Nest instantiates every provider before any
 * `onModuleInit`, and BullMQ workers start in `BullRegistrar.onModuleInit`, so
 * registering later leaves a window where a deactivation skips the GUID audit.
 */
import { userLifecycleHooks } from '../../../users/lifecycle/user-lifecycle.registry';
import {
  WowUserLifecycleRegistrar,
  wowUserLifecycleHooks,
} from './wow-user-lifecycle.hooks';

function registeredWowHooks(): number {
  return userLifecycleHooks().filter((h) => h === wowUserLifecycleHooks).length;
}

describe('WowUserLifecycleRegistrar (ROK-2364)', () => {
  it('registers the wow hooks in its constructor, before any onModuleInit', () => {
    const registrar = new WowUserLifecycleRegistrar();
    expect(registeredWowHooks()).toBe(1);
    expect('onModuleInit' in registrar).toBe(false);
  });

  it('is idempotent: constructing it twice keeps one registration', () => {
    new WowUserLifecycleRegistrar();
    new WowUserLifecycleRegistrar();
    expect(registeredWowHooks()).toBe(1);
  });
});
