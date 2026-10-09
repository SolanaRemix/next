import { HttpException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

type AuditMetadata = Prisma.InputJsonObject;
type AuditSummary<T> = (result: T) => AuditMetadata;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async track<T>(
    actorId: string,
    action: string,
    metadata: AuditMetadata,
    operation: () => Promise<T> | T,
    summarize: AuditSummary<T>,
    options: { recordSuccess?: boolean } = {},
  ): Promise<T> {
    let result: T;
    try {
      result = await operation();
    } catch (error) {
      await this.prisma.auditLog.create({
        data: {
          actorId,
          action,
          metadata: {
            ...metadata,
            outcome: 'failure',
            failureStatus: error instanceof HttpException ? error.getStatus() : 500,
          },
        },
      });
      throw error;
    }

    if (options.recordSuccess !== false) {
      await this.prisma.auditLog.create({
        data: {
          actorId,
          action,
          metadata: { ...metadata, ...summarize(result), outcome: 'success' },
        },
      });
    }
    return result;
  }
}
