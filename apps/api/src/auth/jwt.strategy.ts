import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { AccountStatus } from '@prisma/client';
import type { UserRole } from '@next/types';
import { ExtractJwt, Strategy } from 'passport-jwt';
import {
  JWT_AUDIENCE,
  JWT_ISSUER,
} from './auth.constants.js';
import type { AuthUser } from './auth-user.js';
import { PrismaService } from '../prisma/prisma.service.js';

interface AccessTokenPayload {
  sub?: unknown;
  role?: unknown;
  authVersion?: unknown;
}

const validRoles: readonly string[] = ['SuperAdmin', 'EnterpriseAdmin', 'Trader', 'Viewer', 'Guest'];

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService, private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithms: ['HS256'],
    });
  }

  async validate(payload: AccessTokenPayload): Promise<AuthUser> {
    if (
      typeof payload.sub !== 'string' ||
      !validRoles.includes(String(payload.role)) ||
      (payload.authVersion !== undefined &&
        (!Number.isSafeInteger(payload.authVersion) || (payload.authVersion as number) < 0))
    ) {
      throw new UnauthorizedException();
    }
    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null },
      select: { id: true, email: true, role: true, accountStatus: true, authVersion: true },
    });
    const tokenAuthVersion = payload.authVersion === undefined ? 0 : payload.authVersion;
    if (
      !user ||
      user.accountStatus !== AccountStatus.Active ||
      user.authVersion !== tokenAuthVersion
    ) {
      throw new UnauthorizedException();
    }
    return {
      id: user.id,
      email: user.email,
      role: user.role as UserRole,
      accountStatus: user.accountStatus,
    };
  }
}
