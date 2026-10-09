import { describe, expect, it, vi } from 'vitest';
import { RolesGuard } from './roles.guard.js';
import type { AuthUser } from './auth-user.js';

function contextFor(user: AuthUser | undefined) {
  return {
    getHandler: vi.fn(),
    getClass: vi.fn(),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as never;
}

describe('RolesGuard', () => {
  it('allows the requested role and higher roles', () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(['Trader']) };
    const guard = new RolesGuard(reflector as never);

    expect(guard.canActivate(contextFor({ id: 'id', email: 'a@b.co', role: 'Trader' }))).toBe(true);
    expect(guard.canActivate(contextFor({ id: 'id', email: 'a@b.co', role: 'EnterpriseAdmin' }))).toBe(true);
  });

  it('denies roles below the minimum and requests without a user', () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(['Viewer']) };
    const guard = new RolesGuard(reflector as never);

    expect(guard.canActivate(contextFor({ id: 'id', email: 'a@b.co', role: 'Guest' }))).toBe(false);
    expect(guard.canActivate(contextFor(undefined))).toBe(false);
  });
});
