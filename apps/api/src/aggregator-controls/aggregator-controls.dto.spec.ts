import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateAggregatorControlDto } from './aggregator-controls.dto.js';

describe('UpdateAggregatorControlDto', () => {
  it('accepts supported provider selections and an audit reason', async () => {
    const dto = plainToInstance(UpdateAggregatorControlDto, {
      enabledProviders: ['0x', 'paraswap'],
      reason: 'provider incident',
    });
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects unsupported and duplicate providers or missing reasons', async () => {
    for (const value of [
      { enabledProviders: ['unknown'], reason: 'test' },
      { enabledProviders: ['0x', '0x'], reason: 'duplicate' },
      { enabledProviders: ['0x'], reason: 'x' },
      { enabledProviders: Array(4).fill('0x'), reason: 'too many' },
    ]) {
      await expect(validate(plainToInstance(UpdateAggregatorControlDto, value)))
        .resolves.not.toHaveLength(0);
    }
  });
});
