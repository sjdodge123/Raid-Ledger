/**
 * ROK-1728 review MINOR 3: a Discord "sign up as tentative" click writes one
 * activity row. signup() audits the row, so the follow-up tentative flip
 * opts out of its own `signup_status_changed` row.
 */
import { signupWithCharacter } from './signup-select-role.handlers';
import { createMockDeps } from './signup-handlers.spec-helpers';

describe('signupWithCharacter — tentative', () => {
  it('flips to tentative without a second audit row', async () => {
    const deps = createMockDeps();
    await signupWithCharacter(deps, 10, 42, 'char-1', {}, 'tentative');
    expect(deps.signupsService.signup).toHaveBeenCalledWith(10, 42, {});
    expect(deps.signupsService.updateStatus).toHaveBeenCalledWith(
      10,
      { userId: 42 },
      { status: 'tentative' },
      { audit: false },
    );
  });

  it('does not touch the status for a plain sign-up', async () => {
    const deps = createMockDeps();
    await signupWithCharacter(deps, 10, 42, 'char-1', {});
    expect(deps.signupsService.updateStatus).not.toHaveBeenCalled();
  });
});
