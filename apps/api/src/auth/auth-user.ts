import type { UserRole } from '@next/types';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}
