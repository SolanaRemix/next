import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

const controlId = 'global_execution';

export interface ExecutionControlState {
  enabled: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

@Injectable()
export class FinancialControlsService {
  constructor(private readonly prisma: PrismaService) {}

  async getExecutionControl(): Promise<ExecutionControlState> {
    const control = await this.prisma.financialOperationsControl.findUnique({
      where: { id: controlId },
    });
    return {
      enabled: control?.enabled ?? false,
      updatedAt: control?.updatedAt.toISOString() ?? null,
      updatedBy: control?.updatedBy ?? null,
    };
  }

  async assertExecutionEnabled(): Promise<void> {
    const state = await this.prisma.financialOperationsControl.findUnique({
      where: { id: controlId },
      select: { enabled: true },
    });
    if (!state?.enabled) {
      throw new ServiceUnavailableException('Financial execution is disabled by the global control.');
    }
  }

  async setExecutionControl(
    actorId: string,
    enabled: boolean,
    reason: string,
  ): Promise<ExecutionControlState> {
    return this.prisma.$transaction(async (transaction) => {
      const previous = await transaction.financialOperationsControl.findUnique({
        where: { id: controlId },
        select: { enabled: true },
      });
      const control = await transaction.financialOperationsControl.upsert({
        where: { id: controlId },
        create: { id: controlId, enabled, updatedBy: actorId },
        update: { enabled, updatedBy: actorId },
      });
      await transaction.auditLog.create({
        data: {
          actorId,
          action: 'admin.financial_execution_control.changed',
          metadata: {
            previousEnabled: previous?.enabled ?? false,
            enabled,
            reason: reason.trim(),
          } satisfies Prisma.InputJsonObject,
        },
      });
      return {
        enabled: control.enabled,
        updatedAt: control.updatedAt.toISOString(),
        updatedBy: control.updatedBy,
      };
    });
  }
}
