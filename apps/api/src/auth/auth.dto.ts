import { Transform, Type } from 'class-transformer';
import { IsEmail, IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, IsUUID } from 'class-validator';
import { AccountStatus, UserRole } from '@prisma/client';

export class CredentialsDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}

export class AssignRoleDto {
  @IsEnum(UserRole)
  role!: UserRole;
}

export class UpdateAccountStatusDto {
  @IsEnum(AccountStatus)
  status!: AccountStatus;

  @IsIn(['account_compromise', 'policy_review', 'legal_request', 'other'])
  reason!: 'account_compromise' | 'policy_review' | 'legal_request' | 'other';
}

export class ListUsersQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;

  @IsOptional()
  @IsUUID()
  cursor?: string;
}
