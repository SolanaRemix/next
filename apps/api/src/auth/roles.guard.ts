import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@next/types';
import { REQUIRED_ROLES_KEY } from './auth.constants.js';
import type { AuthUser } from './auth-user.js';

const ROLE_RANK: Record<UserRole, number> = {
  Guest: 0,
  Viewer: 1,
  Trader: 2,
  EnterpriseAdmin: 3,
  SuperAdmin: 4,
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(REQUIRED_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles?.length) return true;
    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user) return false;
    const minimumRank = Math.min(...requiredRoles.map((role) => ROLE_RANK[role]));
    return ROLE_RANK[user.role] >= minimumRank;
  }
}
