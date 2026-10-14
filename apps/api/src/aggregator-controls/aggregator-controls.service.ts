import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { EvmQuoteProvider } from '@next/types';
import { PrismaService } from '../prisma/prisma.service.js';
import { evmQuoteProviders } from './aggregator-controls.dto.js';

const controlId = 'evm_quote_providers';

export interface AggregatorControlState {
  enabledProviders: EvmQuoteProvider[];
  updatedAt: string | null;
  updatedBy: string | null;
}

@Injectable()
export class AggregatorControlsService {
  constructor(private readonly prisma: PrismaService) {}

  async getControl(): Promise<AggregatorControlState> {
    const control = await this.prisma.evmQuoteProviderControl.findUnique({
      where: { id: controlId },
    });
    const enabledProviders = control?.enabledProviders
      .filter((provider): provider is EvmQuoteProvider => evmQuoteProviders.includes(provider as EvmQuoteProvider))
      ?? [];
    return {
      enabledProviders,
      updatedAt: control?.updatedAt.toISOString() ?? null,
      updatedBy: control?.updatedBy ?? null,
    };
  }

  async getEnabledProviders(): Promise<EvmQuoteProvider[]> {
    return (await this.getControl()).enabledProviders;
  }

  async updateControl(
    actorId: string,
    enabledProviders: readonly string[],
    reason: string,
  ): Promise<AggregatorControlState> {
    const uniqueProviders = [...new Set(enabledProviders)];
    if (uniqueProviders.length !== enabledProviders.length
      || uniqueProviders.some((provider) => !evmQuoteProviders.includes(provider as EvmQuoteProvider))) {
      throw new BadRequestException('Unsupported EVM quote provider selection.');
    }
    return this.prisma.$transaction(async (transaction) => {
      await transaction.evmQuoteProviderControl.upsert({
        where: { id: controlId },
        create: { id: controlId, enabledProviders: [] },
        update: {},
      });
      await transaction.$queryRaw<{ id: string }[]>`
        SELECT "id"
        FROM "evm_quote_provider_controls"
        WHERE "id" = ${controlId}
        FOR UPDATE
      `;
      const previous = await transaction.evmQuoteProviderControl.findUnique({
        where: { id: controlId },
        select: { enabledProviders: true },
      });
      const updated = await transaction.evmQuoteProviderControl.update({
        where: { id: controlId },
        data: {
          enabledProviders: uniqueProviders as EvmQuoteProvider[],
          updatedBy: actorId,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId,
          action: 'admin.evm_quote_providers.changed',
          metadata: {
            previousEnabledProviders: previous?.enabledProviders ?? [],
            enabledProviders: uniqueProviders,
            reason: reason.trim(),
          } satisfies Prisma.InputJsonObject,
        },
      });
      return {
        enabledProviders: updated.enabledProviders
          .filter((provider): provider is EvmQuoteProvider => evmQuoteProviders.includes(provider as EvmQuoteProvider)),
        updatedAt: updated.updatedAt.toISOString(),
        updatedBy: updated.updatedBy,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
