import { HttpException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuditQueryDto } from './audit-query.dto.js';

type AuditMetadata = Prisma.InputJsonObject;
type AuditSummary<T> = (result: T) => AuditMetadata;

export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  metadata: Prisma.JsonValue;
  createdAt: string;
}

export interface AuditLogPage {
  entries: AuditLogEntry[];
  nextCursor: string | null;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: AuditQueryDto): Promise<AuditLogPage> {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...(query.actorId ? { actorId: query.actorId } : {}),
        ...(query.action ? { action: query.action } : {}),
      },
      select: {
        id: true,
        actorId: true,
        actor: { select: { email: true } },
        action: true,
        metadata: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > query.limit;
    const entries = rows.slice(0, query.limit).map((row) => ({
      id: row.id,
      actorId: row.actorId,
      actorEmail: row.actor?.email ?? null,
      action: row.action,
      metadata: row.metadata,
      createdAt: row.createdAt.toISOString(),
    }));
    return {
      entries,
      nextCursor: hasMore ? entries.at(-1)?.id ?? null : null,
    };
  }

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
