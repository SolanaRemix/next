import { Prisma, PrismaClient, UserRole } from '@prisma/client';

const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
if (!email) throw new Error('Set BOOTSTRAP_ADMIN_EMAIL to the pre-registered account email.');
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  throw new Error('BOOTSTRAP_ADMIN_EMAIL must be a valid email address.');
}

const prisma = new PrismaClient();
try {
  await prisma.$transaction(async (transaction) => {
    const administrators = await transaction.user.count({
      where: { role: UserRole.SuperAdmin, deletedAt: null },
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (administrators > 0) {
      throw new Error('A SuperAdmin already exists; bootstrap is disabled.');
    }
    const user = await transaction.user.update({
      where: { email },
      data: { role: UserRole.SuperAdmin },
      select: { id: true },
    });
    await transaction.auditLog.create({
      data: { actorId: user.id, action: 'auth.bootstrap_super_admin' },
    });
  });
  console.info('Initial SuperAdmin role assigned.');
} finally {
  await prisma.$disconnect();
}
