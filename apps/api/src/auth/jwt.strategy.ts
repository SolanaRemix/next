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
    if (typeof payload.sub !== 'string' || !validRoles.includes(String(payload.role))) {
      throw new UnauthorizedException();
    }
    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null },
      select: { id: true, email: true, role: true, accountStatus: true },
    });
    if (!user || user.accountStatus !== AccountStatus.Active) throw new UnauthorizedException();
    return { ...user, role: user.role as UserRole };
  }
}
