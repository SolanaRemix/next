import { describe, expect, it } from 'vitest';
import { validateEnvironment } from './environment.js';

const validConfig = {
  DATABASE_URL: 'postgresql://localhost:5432/next?schema=public',
  JWT_ACCESS_SECRET: 'a-valid-test-secret-with-more-than-thirty-two-bytes',
  WEB_ORIGIN: 'https://example.com',
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

  it('requires a valid Redis URL in production and accepts TLS URLs', () => {
    expect(() => validateEnvironment({ ...validConfig, NODE_ENV: 'production' }))
      .toThrow(/REDIS_URL is required/);
    expect(() => validateEnvironment({
      ...validConfig,
      NODE_ENV: 'production',
      REDIS_URL: 'https://redis.example.com',
    })).toThrow(/REDIS_URL/);
    expect(() => validateEnvironment({
      ...validConfig,
      NODE_ENV: 'production',
      REDIS_URL: 'redis://redis.example.com/1',
    })).toThrow(/REDIS_URL/);
    expect(validateEnvironment({
      ...validConfig,
      NODE_ENV: 'production',
      REDIS_URL: 'rediss://redis.example.com:6380',
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
});
