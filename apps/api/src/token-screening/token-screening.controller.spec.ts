import { describe, expect, it, vi } from 'vitest';
import type {
  EvmTokenRiskScreeningResponse,
  SolanaTokenRiskScreeningResponse,
} from '@next/types';
import type { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth-user.js';
import { TokenScreeningController } from './token-screening.controller.js';
import type { TokenScreeningService } from './token-screening.service.js';

const evmResult = {
  chainId: '1',
  tokenAddress: '0x2222222222222222222222222222222222222222',
  source: 'GoPlus',
  riskScore: null,
  riskLevel: 'unknown',
  observedSignals: 2,
  totalSignals: 14,
  signals: {
    honeypot: null,
    openSource: null,
    proxy: null,
    mintable: null,
    ownershipRecoverable: null,
    ownerCanChangeBalance: null,
    hiddenOwner: null,
    selfDestruct: null,
    externalCall: null,
    blacklisted: null,
    transferPausable: null,
    slippageModifiable: null,
    buyTaxPercent: null,
    sellTaxPercent: null,
  },
  indicators: [],
  asOf: '2026-10-11T00:00:00.000Z',
  disclaimer: 'Indicative screening only.',
} satisfies EvmTokenRiskScreeningResponse;

const solanaResult = {
  network: 'solana-mainnet',
  tokenAddress: 'So11111111111111111111111111111111111111112',
  source: 'GoPlus Solana beta',
  riskScore: null,
  riskLevel: 'unknown',
  observedSignals: 0,
  totalSignals: 14,
  signals: {
    mintable: null,
    freezable: null,
    closable: null,
    balanceMutable: null,
    metadataMutable: null,
    transferFeeEnabled: null,
    transferFeeUpgradable: null,
    transferHookPresent: null,
    maliciousTransferHook: null,
    transferHookUpgradable: null,
    defaultAccountFrozen: null,
    defaultAccountStateUpgradable: null,
    nonTransferable: null,
    trustedToken: null,
  },
  indicators: [],
  asOf: '2026-10-11T00:00:00.000Z',
  disclaimer: 'Indicative screening only.',
} satisfies SolanaTokenRiskScreeningResponse;

describe('TokenScreeningController', () => {
  const user: AuthUser = {
    id: 'user-id',
    email: 'viewer@example.com',
    role: 'Viewer',
  };

  it('audits EVM screening without storing the token address', async () => {
    const screenEvmToken = vi.fn().mockResolvedValue(evmResult);
    let auditEntry: Record<string, unknown> | undefined;
    const track = vi.fn(async (
      actorId: string,
      action: string,
      metadata: Record<string, unknown>,
      operation: () => Promise<EvmTokenRiskScreeningResponse>,
      summarize: (result: EvmTokenRiskScreeningResponse) => Record<string, unknown>,
    ) => {
      const result = await operation();
      auditEntry = {
        actorId,
        action,
        metadata: { ...metadata, ...summarize(result) },
      };
      return result;
    });
    const controller = new TokenScreeningController(
      { screenEvmToken } as unknown as TokenScreeningService,
      { track } as unknown as AuditService,
    );

    const response = await controller.screenEvmToken(
      { chainId: '1', tokenAddress: evmResult.tokenAddress },
      user,
    );

    expect(response).toBe(evmResult);
    expect(screenEvmToken).toHaveBeenCalledWith('1', evmResult.tokenAddress);
    expect(track).toHaveBeenCalledWith(
      user.id,
      'token_screening.evm.requested',
      { chainId: '1' },
      expect.any(Function),
      expect.any(Function),
    );
    expect(auditEntry).toEqual({
      actorId: user.id,
      action: 'token_screening.evm.requested',
      metadata: { chainId: '1', riskLevel: 'unknown', observedSignals: 2, totalSignals: 14 },
    });
    expect(JSON.stringify(auditEntry)).not.toContain(evmResult.tokenAddress);
  });

  it('audits Solana screening and omits the mint from audit metadata', async () => {
    const screenSolanaToken = vi.fn().mockResolvedValue(solanaResult);
    let auditMetadata: Record<string, unknown> | undefined;
    const track = vi.fn(async (
      _actorId: string,
      _action: string,
      metadata: Record<string, unknown>,
      operation: () => Promise<SolanaTokenRiskScreeningResponse>,
      summarize: (result: SolanaTokenRiskScreeningResponse) => Record<string, unknown>,
    ) => {
      const result = await operation();
      auditMetadata = { ...metadata, ...summarize(result) };
      return result;
    });
    const controller = new TokenScreeningController(
      { screenSolanaToken } as unknown as TokenScreeningService,
      { track } as unknown as AuditService,
    );

    await controller.screenSolanaToken({ mint: solanaResult.tokenAddress }, user);

    expect(screenSolanaToken).toHaveBeenCalledWith(solanaResult.tokenAddress);
    expect(track).toHaveBeenCalledWith(
      user.id,
      'token_screening.solana.requested',
      { network: 'solana-mainnet' },
      expect.any(Function),
      expect.any(Function),
    );
    expect(auditMetadata).toEqual({
      network: 'solana-mainnet',
      riskLevel: 'unknown',
      observedSignals: 0,
      totalSignals: 14,
    });
    expect(JSON.stringify(auditMetadata)).not.toContain(solanaResult.tokenAddress);
  });
});
