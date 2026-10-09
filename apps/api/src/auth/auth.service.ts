import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import {
  JWT_AUDIENCE,
  JWT_ISSUER,
  REFRESH_TOKEN_TTL_MILLISECONDS,
} from './auth.constants.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface PublicUser {
  id: string;
  email: string;
  role: UserRole;
}

export interface AdminUser extends PublicUser {
  createdAt: Date;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: PublicUser;
}

function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(email: string, password: string): Promise<AuthSession> {
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: {
            email: email.trim().toLowerCase(),
            passwordHash,
            role: UserRole.Guest,
          },
          select: { id: true, email: true, role: true },
        });
        return this.persistSession(transaction, user, 'auth.register');
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        await this.prisma.auditLog.create({ data: { action: 'auth.register.duplicate' } });
        throw new ConflictException('An account with this email already exists.');
      }
      throw error;
    }
  }

  async login(email: string, password: string): Promise<AuthSession> {
    const user = await this.prisma.user.findFirst({
      where: { email: email.trim().toLowerCase(), deletedAt: null },
    });
    if (!user || !(await argon2.verify(user.passwordHash, password))) {
      await this.prisma.auditLog.create({
        data: { action: 'auth.login.failed', ...(user ? { actorId: user.id } : {}) },
      });
      throw new UnauthorizedException('Invalid email or password.');
    }
    return this.createSession(user, 'auth.login');
  }

  async refresh(refreshToken: string | undefined): Promise<AuthSession> {
    if (!refreshToken || !/^[A-Za-z0-9_-]{43}$/.test(refreshToken)) {
      throw new UnauthorizedException('Refresh session is invalid or expired.');
    }
    const tokenHash = hashRefreshToken(refreshToken);
    try {
      return await this.prisma.$transaction(async (transaction) => {
      const stored = await transaction.refreshToken.findUnique({
        where: { tokenHash },
        include: { user: true },
      });
      const now = new Date();
      if (!stored || stored.revokedAt || stored.expiresAt <= now || stored.user.deletedAt) {
        throw new UnauthorizedException('Refresh session is invalid or expired.');
      }
      const revoked = await transaction.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null, expiresAt: { gt: now } },
        data: { revokedAt: now },
      });
      if (revoked.count !== 1) {
        throw new UnauthorizedException('Refresh session is invalid or expired.');
      }
        return this.persistSession(transaction, stored.user, 'auth.refresh');
      });
    } catch (error) {
      await this.prisma.auditLog.create({ data: { action: 'auth.refresh.failed' } });
      throw error;
    }
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    const tokenHash = refreshToken && /^[A-Za-z0-9_-]{43}$/.test(refreshToken)
      ? hashRefreshToken(refreshToken)
      : null;
    await this.prisma.$transaction(async (transaction) => {
      let actorId: string | undefined;
      if (tokenHash) {
        const stored = await transaction.refreshToken.findUnique({
          where: { tokenHash },
          select: { id: true, userId: true },
        });
        if (stored) {
          actorId = stored.userId;
          await transaction.refreshToken.updateMany({
            where: { id: stored.id, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }
      }
      await transaction.auditLog.create({
        data: { action: 'auth.logout', ...(actorId ? { actorId } : {}) },
      });
    });
  }

  async listUsers(limit: number, cursor?: string): Promise<AdminUser[]> {
    return this.prisma.user.findMany({
      where: { deletedAt: null },
      select: { id: true, email: true, role: true, createdAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }

  async assignRole(actorId: string, targetId: string, role: UserRole): Promise<PublicUser> {
    return this.prisma.$transaction(async (transaction) => {
      const actor = await transaction.user.findFirst({
        where: { id: actorId, role: UserRole.SuperAdmin, deletedAt: null },
        select: { id: true },
      });
      if (!actor) throw new UnauthorizedException('SuperAdmin access is required.');
      const target = await transaction.user.findFirst({
        where: { id: targetId, deletedAt: null },
        select: { id: true, email: true, role: true },
      });
      if (!target) throw new NotFoundException('User not found.');
      if (target.role === UserRole.SuperAdmin && role !== UserRole.SuperAdmin) {
        const count = await transaction.user.count({
          where: { role: UserRole.SuperAdmin, deletedAt: null },
        });
        if (count <= 1) {
          throw new ConflictException('The last SuperAdmin cannot be demoted.');
        }
      }
      const updated = await transaction.user.update({
        where: { id: targetId },
        data: { role },
        select: { id: true, email: true, role: true },
      });
      await transaction.auditLog.create({
        data: {
          actorId,
          action: 'admin.user.role_changed',
          metadata: { targetId, previousRole: target.role, newRole: role },
        },
      });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async createSession(user: PublicUser, action: string): Promise<AuthSession> {
    return this.prisma.$transaction((transaction) => this.persistSession(transaction, user, action));
  }

  private async persistSession(
    transaction: Prisma.TransactionClient,
    user: PublicUser,
    action: string,
  ): Promise<AuthSession> {
    const refreshToken = newRefreshToken();
    await transaction.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MILLISECONDS),
      },
    });
    await transaction.auditLog.create({
      data: { actorId: user.id, action },
    });
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, role: user.role },
      {
        audience: JWT_AUDIENCE,
        issuer: JWT_ISSUER,
        expiresIn: '15m',
      },
    );
    return {
      accessToken,
      refreshToken,
      expiresIn: 15 * 60,
      user: { id: user.id, email: user.email, role: user.role },
    };
  }
}
