import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';
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
      .mockResolvedValueOnce({ id: 'admin-id', email: 'admin@example.com', role: UserRole.SuperAdmin });
    transaction.user.count.mockResolvedValue(1);

    await expect(service.assignRole('admin-id', 'admin-id', UserRole.Guest))
      .rejects.toThrow(/last SuperAdmin/i);
    expect(transaction.user.update).not.toHaveBeenCalled();
  });

  it('returns active user details without password hashes for the admin directory', async () => {
    const { service, prisma } = createFixture();
    const findMany = vi.fn().mockResolvedValue([{
      id: user.id,
      email: user.email,
      role: UserRole.Guest,
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
