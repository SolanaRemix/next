import { describe, expect, it } from 'vitest';
import { validateEnvironment } from './environment.js';

const validConfig = {
  DATABASE_URL: 'postgresql://localhost:5432/next?schema=public',
  JWT_ACCESS_SECRET: 'a-valid-test-secret-with-more-than-thirty-two-bytes',
  WEB_ORIGIN: 'https://example.com',
};

const productionRpcConfig = {
  NODE_ENV: 'production',
  REDIS_URL: 'rediss://redis.example.com:6380',
  RPC_PRIVATE_HOSTS: 'solana.private.example,evm.private.example',
  SOLANA_RPC_URL: 'https://solana.private.example/rpc',
  ...Object.fromEntries(
    ['1', '10', '56', '137', '8453', '42161', '43114']
      .map((chainId) => [`EVM_RPC_URL_${chainId}`, 'https://evm.private.example/rpc']),
  ),
};

describe('validateEnvironment', () => {
  it('accepts PostgreSQL configuration and a sufficiently strong JWT secret', () => {
    expect(validateEnvironment(validConfig)).toEqual(validConfig);
  });

  it('rejects missing database configuration and weak signing secrets', () => {
    expect(() => validateEnvironment({ ...validConfig, DATABASE_URL: '' }))
      .toThrow(/DATABASE_URL/);
    expect(() => validateEnvironment({ ...validConfig, JWT_ACCESS_SECRET: 'too-short' }))
      .toThrow(/32 bytes/);
  });

  it('rejects invalid browser origins', () => {
    expect(() => validateEnvironment({ ...validConfig, WEB_ORIGIN: 'https://example.com/path' }))
      .toThrow(/WEB_ORIGIN/);
    expect(() => validateEnvironment({ ...validConfig, WEB_ORIGIN: 'javascript:alert(1)' }))
      .toThrow(/WEB_ORIGIN/);
  });

  it('validates OpenTelemetry collector URLs and service names', () => {
    expect(validateEnvironment({
      ...validConfig,
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.example/otel',
      OTEL_SERVICE_NAME: 'next-api.production',
    })).toMatchObject({ OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.example/otel' });
    expect(() => validateEnvironment({
      ...validConfig,
      OTEL_EXPORTER_OTLP_ENDPOINT: 'ftp://collector.example',
    })).toThrow(/without credentials or query data/i);
    expect(() => validateEnvironment({
      ...validConfig,
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.example?attribute=value',
    })).toThrow(/without credentials or query data/i);
    expect(() => validateEnvironment({
      ...validConfig,
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://user@collector.example',
    })).toThrow(/without credentials or query data/i);
    expect(() => validateEnvironment({
      ...validConfig,
      OTEL_SERVICE_NAME: 'invalid service name',
    })).toThrow(/OTEL_SERVICE_NAME/);
  });

  it('requires a valid Redis URL in production and accepts TLS URLs', () => {
    expect(() => validateEnvironment({ ...validConfig, NODE_ENV: 'production' }))
      .toThrow(/REDIS_URL is required/);
    expect(() => validateEnvironment({
      ...validConfig,
      ...productionRpcConfig,
      NODE_ENV: 'production',
      REDIS_URL: 'https://redis.example.com',
    })).toThrow(/REDIS_URL/);
    expect(() => validateEnvironment({
      ...validConfig,
      ...productionRpcConfig,
      NODE_ENV: 'production',
      REDIS_URL: 'redis://redis.example.com/1',
    })).toThrow(/REDIS_URL/);
    expect(validateEnvironment({
      ...validConfig,
      ...productionRpcConfig,
    })).toMatchObject({ REDIS_URL: 'rediss://redis.example.com:6380' });
  });

  it('requires valid countries and trusted proxy CIDRs for geographic restrictions', () => {
    expect(() => validateEnvironment({
      ...validConfig,
      GEO_BLOCKED_COUNTRIES: 'US,GB',
    })).toThrow(/trusted proxy CIDRs/i);
    expect(() => validateEnvironment({
      ...validConfig,
      GEO_BLOCKED_COUNTRIES: 'USA',
      GEO_TRUSTED_PROXY_CIDRS: '192.0.2.0/24',
    })).toThrow(/ISO country codes/i);
    expect(() => validateEnvironment({
      ...validConfig,
      GEO_BLOCKED_COUNTRIES: 'US',
      GEO_TRUSTED_PROXY_CIDRS: 'not-a-cidr',
    })).toThrow(/valid CIDR ranges/i);
    expect(validateEnvironment({
      ...validConfig,
      GEO_BLOCKED_COUNTRIES: 'US, GB',
      GEO_TRUSTED_PROXY_CIDRS: '192.0.2.0/24,2001:db8::/32',
    })).toMatchObject({ GEO_BLOCKED_COUNTRIES: 'US, GB' });
  });

  it('accepts secure Solana RPC endpoints and only permits local HTTP in development', () => {
    expect(validateEnvironment({
      ...validConfig,
      SOLANA_RPC_URL: 'https://rpc.example.com/?api=example',
    })).toMatchObject({ SOLANA_RPC_URL: 'https://rpc.example.com/?api=example' });
    expect(validateEnvironment({
      ...validConfig,
      SOLANA_RPC_URL: 'http://localhost:8899',
    })).toMatchObject({ SOLANA_RPC_URL: 'http://localhost:8899' });
    expect(() => validateEnvironment({
      ...validConfig,
      ...productionRpcConfig,
      NODE_ENV: 'production',
      SOLANA_RPC_URL: 'http://localhost:8899',
    })).toThrow(/SOLANA_RPC_URL/);
    expect(() => validateEnvironment({
      ...validConfig,
      SOLANA_RPC_URL: 'not-a-url',
    })).toThrow(/SOLANA_RPC_URL/);
  });

  it('validates per-chain EVM settlement RPC endpoints', () => {
    expect(validateEnvironment({
    ...validConfig,
    EVM_RPC_URL_1: 'https://ethereum.example.com/rpc?key=secret',
    EVM_RPC_URL_8453: 'http://localhost:8545',
    })).toMatchObject({ EVM_RPC_URL_1: 'https://ethereum.example.com/rpc?key=secret' });
    expect(() => validateEnvironment({
    ...validConfig,
    EVM_RPC_URL_999: 'https://rpc.example.com',
    })).toThrow(/supported EVM chain/);
    expect(() => validateEnvironment({
    ...validConfig,
    ...productionRpcConfig,
    NODE_ENV: 'production',
    EVM_RPC_URL_1: 'http://localhost:8545',
    })).toThrow(/EVM_RPC_URL_1/);
    expect(() => validateEnvironment({
    ...validConfig,
    EVM_RPC_URL_1: '******rpc.example.com',
    })).toThrow(/EVM_RPC_URL_1/);
    expect(validateEnvironment({
    ...validConfig,
    EVM_CONFIRMATIONS_1: '12',
    })).toMatchObject({ EVM_CONFIRMATIONS_1: '12' });
    expect(() => validateEnvironment({
    ...validConfig,
    EVM_CONFIRMATIONS_1: '1',
    })).toThrow(/between 2 and 1000/);
    expect(() => validateEnvironment({
    ...validConfig,
    EVM_CONFIRMATIONS_1: '1e2',
    })).toThrow(/between 2 and 1000/);
  });

  it('requires approved private RPCs for every production chain', () => {
    expect(validateEnvironment({ ...validConfig, ...productionRpcConfig }))
      .toMatchObject(productionRpcConfig);
    expect(() => validateEnvironment({
      ...validConfig,
      ...productionRpcConfig,
      EVM_RPC_URL_56: undefined,
    })).toThrow(/EVM_RPC_URL_56 is required/);
    expect(() => validateEnvironment({
      ...validConfig,
      ...productionRpcConfig,
      SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com',
    })).toThrow(/SOLANA_RPC_URL must use an approved private RPC hostname/);
    expect(() => validateEnvironment({
      ...validConfig,
      ...productionRpcConfig,
      RPC_PRIVATE_HOSTS: 'evm.private.example',
    })).toThrow(/SOLANA_RPC_URL must use an approved private RPC hostname/);
    expect(() => validateEnvironment({
      ...validConfig,
      ...productionRpcConfig,
      RPC_PRIVATE_HOSTS: 'https://evm.private.example/rpc',
    })).toThrow(/RPC_PRIVATE_HOSTS must contain hostnames only/);
  });
});
