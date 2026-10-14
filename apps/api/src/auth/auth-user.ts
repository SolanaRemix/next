import type { UserRole } from '@next/types';
import type { AccountStatus } from '@prisma/client';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  accountStatus?: AccountStatus;
}
