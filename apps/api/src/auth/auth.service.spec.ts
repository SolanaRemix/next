import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountStatus, UserRole } from '@prisma/client';
import { createHash } from 'node:crypto';
import { AuthService } from './auth.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

const { argonHash, argonVerify } = vi.hoisted(() => ({
  argonHash: vi.fn(),
  argonVerify: vi.fn(),
}));

vi.mock('argon2', () => ({
  argon2id: 2,
  hash: argonHash,
  verify: argonVerify,
}));

const user = {
  id: '4d087e74-7254-43a2-a3f1-3f1c5bce51a2',
  email: 'user@example.com',
  passwordHash: 'argon2id-hash',
  role: UserRole.Guest,
  accountStatus: AccountStatus.Active,
  deletedAt: null,
};

function createFixture() {
  const transaction = {
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    user: {
      create: vi.fn().mockResolvedValue({
        id: user.id,
        email: user.email,
        role: UserRole.Guest,
        accountStatus: AccountStatus.Active,
      }),
      findFirst: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    refreshToken: {
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    user: { findFirst: vi.fn() },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    refreshToken: {
      findMany: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: vi.fn(async <T>(callback: (tx: typeof transaction) => Promise<T>) =>
      callback(transaction)),
  };
  const jwt = { signAsync: vi.fn().mockResolvedValue('signed-access-token') };
  return {
    service: new AuthService(prisma as unknown as PrismaService, jwt as never),
    prisma,
    transaction,
    jwt,
  };
}

describe('AuthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    argonHash.mockResolvedValue('argon2id-hash');
    argonVerify.mockResolvedValue(true);
  });

  it('registers new accounts as Guest and stores only a hash of a random refresh token', async () => {
    const { service, transaction } = createFixture();

    const session = await service.register('USER@example.com', 'a-secure-password');

    expect(transaction.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        email: 'user@example.com',
        passwordHash: 'argon2id-hash',
        role: UserRole.Guest,
      }),
    }));
    expect(session.user.role).toBe(UserRole.Guest);
    expect(session.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(transaction.refreshToken.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tokenHash: expect.not.stringContaining(session.refreshToken),
      }),
    }));
    expect(session.accessToken).toBe('signed-access-token');
  });

  it('does not authenticate soft-deleted users or incorrect passwords', async () => {
    const { service, prisma } = createFixture();
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(service.login('user@example.com', 'incorrect-password'))
      .rejects.toThrow('Invalid email or password.');
    expect(argonVerify).not.toHaveBeenCalled();

    prisma.user.findFirst.mockResolvedValue(user);
    argonVerify.mockResolvedValue(false);
    await expect(service.login('user@example.com', 'incorrect-password'))
      .rejects.toThrow('Invalid email or password.');
  });

  it('rejects restricted accounts during login and token refresh', async () => {
    const { service, prisma, transaction } = createFixture();
    prisma.user.findFirst.mockResolvedValue({
      ...user,
      accountStatus: AccountStatus.Restricted,
    });
    await expect(service.login('user@example.com', 'a-secure-password'))
      .rejects.toThrow('Invalid email or password.');
    expect(argonVerify).not.toHaveBeenCalled();

    transaction.refreshToken.findUnique.mockResolvedValue({
      id: 'refresh-id',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: { ...user, accountStatus: AccountStatus.Restricted },
    });
    await expect(service.refresh('A'.repeat(43)))
      .rejects.toThrow(/invalid or expired/i);
    expect(transaction.refreshToken.create).not.toHaveBeenCalled();
  });

  it('rotates a refresh token once and returns a fresh access token', async () => {
    const { service, transaction } = createFixture();
    transaction.refreshToken.findUnique.mockResolvedValue({
      id: 'refresh-id',
      tokenHash: 'unused',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user,
    });

    const session = await service.refresh('A'.repeat(43));

    expect(transaction.refreshToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'refresh-id', revokedAt: null }),
    }));
    expect(transaction.refreshToken.create).toHaveBeenCalledTimes(1);
    expect(session.refreshToken).not.toBe('A'.repeat(43));
    expect(session.accessToken).toBe('signed-access-token');
  });

  it('rejects a replayed or expired refresh token', async () => {
    const { service, transaction } = createFixture();
    transaction.refreshToken.findUnique.mockResolvedValue({
      id: 'refresh-id',
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      user,
    });

    await expect(service.refresh('A'.repeat(43))).rejects.toThrow(/invalid or expired/i);
    expect(transaction.refreshToken.create).not.toHaveBeenCalled();
    await expect(service.refresh('invalid')).rejects.toThrow(/invalid or expired/i);
  });

  it('revokes refresh sessions without storing raw tokens', async () => {
    const { service, prisma, transaction } = createFixture();

    await service.logout('A'.repeat(43));
    await service.logout(undefined);

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(transaction.auditLog.create).toHaveBeenCalledTimes(2);
  });

  it('lists only the user sessions and never returns refresh token hashes', async () => {
    const { service, prisma } = createFixture();
    const currentToken = 'A'.repeat(43);
    const current = {
      id: 'c15c090e-2615-4e52-ad67-f212a4154074',
      tokenHash: createHash('sha256').update(currentToken).digest('hex'),
      createdAt: new Date('2026-10-09T00:00:00.000Z'),
      expiresAt: new Date('2026-11-09T00:00:00.000Z'),
      revokedAt: null,
    };
    prisma.refreshToken.findMany.mockResolvedValue([
      current,
      { ...current, id: '3c6164e9-6504-4f61-9a74-728084a9ab38', tokenHash: 'another-hash' },
    ]);

    const sessions = await service.listSessions(user.id, currentToken);

    expect(sessions).toEqual([
      expect.objectContaining({ id: current.id, current: true }),
      expect.objectContaining({ id: '3c6164e9-6504-4f61-9a74-728084a9ab38', current: false }),
    ]);
    expect(sessions[0]).not.toHaveProperty('tokenHash');
    expect(prisma.refreshToken.findMany).toHaveBeenCalledWith({
      where: { userId: user.id },
      select: { id: true, tokenHash: true, createdAt: true, expiresAt: true, revokedAt: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  });

  it('revokes an owned session and audits the action transactionally', async () => {
    const { service, prisma, transaction } = createFixture();
    const sessionId = 'c15c090e-2615-4e52-ad67-f212a4154074';

    await service.revokeSession(user.id, sessionId);

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(transaction.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { id: sessionId, userId: user.id, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: user.id,
        action: 'auth.session.revoked',
        metadata: { sessionId },
      },
    });
  });

  it('does not revoke or disclose a session belonging to another user', async () => {
    const { service, transaction } = createFixture();
    transaction.refreshToken.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.revokeSession(user.id, 'c15c090e-2615-4e52-ad67-f212a4154074'))
      .rejects.toThrow(/Session not found/);
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });

  it('revokes other active sessions but preserves and audits the current session', async () => {
    const { service, transaction, prisma } = createFixture();
    const currentToken = 'A'.repeat(43);
    const currentSessionId = 'c15c090e-2615-4e52-ad67-f212a4154074';
    transaction.refreshToken.findUnique.mockResolvedValue({
      id: currentSessionId,
      userId: user.id,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    });
    transaction.refreshToken.updateMany.mockResolvedValue({ count: 2 });

    await expect(service.revokeOtherSessions(user.id, currentToken)).resolves.toBe(2);

    expect(transaction.refreshToken.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: createHash('sha256').update(currentToken, 'utf8').digest('hex') },
      select: { id: true, userId: true, expiresAt: true, revokedAt: true },
    });
    expect(transaction.refreshToken.updateMany).toHaveBeenCalledWith({
      where: {
        userId: user.id,
        id: { not: currentSessionId },
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      data: { revokedAt: expect.any(Date) },
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: user.id,
        action: 'auth.sessions.others_revoked',
        metadata: { revokedCount: 2 },
      },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'Serializable' },
    );
  });

  it('does not revoke sessions when the current refresh token is missing or invalid', async () => {
    const { service, prisma, transaction } = createFixture();

    await expect(service.revokeOtherSessions(user.id, undefined))
      .rejects.toThrow(/current refresh session is invalid/i);
    await expect(service.revokeOtherSessions(user.id, 'invalid'))
      .rejects.toThrow(/current refresh session is invalid/i);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(transaction.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('rejects expired, revoked, or foreign current refresh sessions', async () => {
    const { service, transaction } = createFixture();
    const currentToken = 'A'.repeat(43);
    const invalidSessions = [
      {
        id: 'expired-session',
        userId: user.id,
        expiresAt: new Date(Date.now() - 60_000),
        revokedAt: null,
      },
      {
        id: 'revoked-session',
        userId: user.id,
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: new Date(),
      },
      {
        id: 'foreign-session',
        userId: 'another-user',
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
      },
    ];
    for (const session of invalidSessions) {
      transaction.refreshToken.findUnique.mockResolvedValueOnce(session);
      await expect(service.revokeOtherSessions(user.id, currentToken))
        .rejects.toThrow(/current refresh session is invalid/i);
    }
    expect(transaction.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });

  it('assigns roles only through an audited SuperAdmin action', async () => {
    const { service, transaction } = createFixture();
    transaction.user.findFirst
      .mockResolvedValueOnce({ id: 'admin-id' })
      .mockResolvedValueOnce({ id: user.id, email: user.email, role: UserRole.Guest });
    transaction.user.update.mockResolvedValue({
      id: user.id,
      email: user.email,
      role: UserRole.Trader,
    });

    const updated = await service.assignRole('admin-id', user.id, UserRole.Trader);

    expect(updated.role).toBe(UserRole.Trader);
    expect(transaction.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        actorId: 'admin-id',
        action: 'admin.user.role_changed',
        metadata: expect.objectContaining({ targetId: user.id, newRole: UserRole.Trader }),
      }),
    }));
  });

  it('prevents demoting the final SuperAdmin', async () => {
    const { service, transaction } = createFixture();
    transaction.user.findFirst
      .mockResolvedValueOnce({ id: 'admin-id' })
      .mockResolvedValueOnce({
        id: 'admin-id',
        email: 'admin@example.com',
        role: UserRole.SuperAdmin,
        accountStatus: AccountStatus.Active,
      });
    transaction.user.count.mockResolvedValue(1);

    await expect(service.assignRole('admin-id', 'admin-id', UserRole.Guest))
      .rejects.toThrow(/last SuperAdmin/i);
    expect(transaction.user.update).not.toHaveBeenCalled();
  });

  it('restricts accounts, revokes refresh sessions, and audits the reason code', async () => {
    const { service, transaction } = createFixture();
    const target = {
      id: user.id,
      email: user.email,
      role: UserRole.Guest,
      accountStatus: AccountStatus.Active,
      createdAt: new Date(),
    };
    transaction.user.findFirst
      .mockResolvedValueOnce({ id: 'admin-id' })
      .mockResolvedValueOnce(target);
    transaction.user.update.mockResolvedValue({
      ...target,
      accountStatus: AccountStatus.Restricted,
    });

    const updated = await service.setAccountStatus(
      'admin-id',
      user.id,
      AccountStatus.Restricted,
      'policy_review',
    );

    expect(updated.accountStatus).toBe(AccountStatus.Restricted);
    expect(transaction.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 'admin-id',
        action: 'admin.user.account_status_changed',
        metadata: expect.objectContaining({
          targetId: user.id,
          previousStatus: AccountStatus.Active,
          newStatus: AccountStatus.Restricted,
          reason: 'policy_review',
        }),
      }),
    });
  });

  it('prevents restricting the final active SuperAdmin and self-restriction', async () => {
    const { service, transaction } = createFixture();
    const admin = {
      id: 'admin-id',
      email: 'admin@example.com',
      role: UserRole.SuperAdmin,
      accountStatus: AccountStatus.Active,
      createdAt: new Date(),
    };
    transaction.user.findFirst
      .mockResolvedValueOnce({ id: 'admin-id' })
      .mockResolvedValueOnce(admin);
    transaction.user.count.mockResolvedValue(1);

    await expect(service.setAccountStatus(
      'admin-id',
      'admin-id',
      AccountStatus.Restricted,
      'legal_request',
    )).rejects.toThrow(/cannot restrict their own account/i);
    expect(transaction.user.update).not.toHaveBeenCalled();

    transaction.user.findFirst
      .mockResolvedValueOnce({ id: 'admin-id' })
      .mockResolvedValueOnce({ ...admin, id: user.id, role: UserRole.SuperAdmin });
    await expect(service.setAccountStatus(
      'admin-id',
      user.id,
      AccountStatus.Restricted,
      'legal_request',
    )).rejects.toThrow(/last active SuperAdmin/i);
    expect(transaction.user.update).not.toHaveBeenCalled();
  });

  it('returns active user details without password hashes for the admin directory', async () => {
    const { service, prisma } = createFixture();
    const findMany = vi.fn().mockResolvedValue([{
      id: user.id,
      email: user.email,
      role: UserRole.Guest,
      accountStatus: AccountStatus.Active,
      createdAt: new Date(),
    }]);
    const serviceWithList = new AuthService(
      { ...prisma, user: { ...prisma.user, findMany } } as unknown as PrismaService,
      { signAsync: vi.fn() } as never,
    );

    const users = await serviceWithList.listUsers(20, undefined);

    expect(users[0]).not.toHaveProperty('passwordHash');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { deletedAt: null },
      take: 20,
    }));
  });
});
