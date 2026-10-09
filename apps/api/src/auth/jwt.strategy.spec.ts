import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { AccountStatus, UserRole } from '@prisma/client';
import { JwtStrategy } from './jwt.strategy.js';
import type { PrismaService } from '../prisma/prisma.service.js';

function createStrategy(accountStatus: AccountStatus | null) {
  const prisma = {
    user: {
      findFirst: vi.fn().mockResolvedValue(accountStatus ? {
        id: 'user-id',
        email: 'user@example.com',
        role: UserRole.Trader,
        accountStatus,
      } : null),
    },
  };
  const config = { getOrThrow: vi.fn(() => 'a-valid-test-secret-with-more-than-thirty-two-bytes') };
  return {
    strategy: new JwtStrategy(config as never, prisma as unknown as PrismaService),
    prisma,
  };
}

describe('JwtStrategy', () => {
  it('authenticates active users using the current database role', async () => {
    const { strategy, prisma } = createStrategy(AccountStatus.Active);

    await expect(strategy.validate({ sub: 'user-id', role: UserRole.Guest }))
      .resolves.toEqual({
        id: 'user-id',
        email: 'user@example.com',
        role: UserRole.Trader,
        accountStatus: AccountStatus.Active,
      });
    expect(prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user-id', deletedAt: null },
    }));
  });

  it('rejects restricted or deleted accounts', async () => {
    const restricted = createStrategy(AccountStatus.Restricted);
    await expect(restricted.strategy.validate({ sub: 'user-id', role: UserRole.Trader }))
      .rejects.toBeInstanceOf(UnauthorizedException);

    const deleted = createStrategy(null);
    await expect(deleted.strategy.validate({ sub: 'user-id', role: UserRole.Trader }))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });
});
