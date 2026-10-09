import ipaddr from 'ipaddr.js';

export function validateEnvironment(config: Record<string, unknown>): Record<string, unknown> {
  const databaseUrl = config.DATABASE_URL;
  const jwtSecret = config.JWT_ACCESS_SECRET;
  let database: URL | null = null;
  try {
    if (typeof databaseUrl === 'string') database = new URL(databaseUrl);
  } catch {
    database = null;
  }
  if (
    !database ||
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    !database.hostname ||
    !database.pathname || database.pathname === '/'
  ) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL.');
  }
  if (typeof jwtSecret !== 'string' || Buffer.byteLength(jwtSecret, 'utf8') < 32) {
    throw new Error('JWT_ACCESS_SECRET must contain at least 32 bytes.');
  }
  const redisUrl = config.REDIS_URL;
  if (config.NODE_ENV === 'production' && typeof redisUrl !== 'string') {
    throw new Error('REDIS_URL is required in production.');
  }
  if (redisUrl !== undefined) {
    if (typeof redisUrl !== 'string') throw new Error('REDIS_URL must be a valid Redis URL.');
    try {
      const redis = new URL(redisUrl);
      if (
        !['redis:', 'rediss:'].includes(redis.protocol) ||
        !redis.hostname ||
        redis.search ||
        redis.hash ||
        (config.NODE_ENV === 'production' && !['', '/', '/0'].includes(redis.pathname))
      ) {
        throw new Error('REDIS_URL must be a valid Redis endpoint and use database 0 in production.');
      }
    } catch {
      throw new Error('REDIS_URL must be a valid Redis endpoint and use database 0 in production.');
    }
  }
  const blockedCountries = config.GEO_BLOCKED_COUNTRIES;
  const trustedProxyCidrs = config.GEO_TRUSTED_PROXY_CIDRS;
  if (blockedCountries !== undefined) {
    if (typeof blockedCountries !== 'string') {
      throw new Error('GEO_BLOCKED_COUNTRIES must be a comma-separated list of ISO country codes.');
    }
    const countries = blockedCountries.split(',').map((country) => country.trim()).filter(Boolean);
    if (
      countries.some((country) => !/^[A-Z]{2}$/.test(country)) ||
      (countries.length > 0 && typeof trustedProxyCidrs !== 'string')
    ) {
      throw new Error('Geo controls require ISO country codes and trusted proxy CIDRs.');
    }
  }
  if (trustedProxyCidrs !== undefined) {
    if (typeof trustedProxyCidrs !== 'string') {
      throw new Error('GEO_TRUSTED_PROXY_CIDRS must be a comma-separated list of CIDR ranges.');
    }
    const cidrs = trustedProxyCidrs.split(',').map((cidr) => cidr.trim()).filter(Boolean);
    if (
      cidrs.some((cidr) => {
        try {
          ipaddr.parseCIDR(cidr);
          return false;
        } catch {
          return true;
        }
      }) ||
      (typeof blockedCountries === 'string' &&
        blockedCountries.split(',').map((country) => country.trim()).filter(Boolean).length > 0 &&
        cidrs.length === 0)
    ) {
      throw new Error('GEO_TRUSTED_PROXY_CIDRS must contain valid CIDR ranges when geo controls are enabled.');
    }
  }
  const webOrigin = config.WEB_ORIGIN;
  if (webOrigin !== undefined) {
    if (typeof webOrigin !== 'string') throw new Error('WEB_ORIGIN must be a valid origin URL.');
    try {
      const origin = new URL(webOrigin);
      if (origin.origin !== webOrigin || !['http:', 'https:'].includes(origin.protocol)) {
        throw new Error('WEB_ORIGIN must be an HTTP(S) origin without a path.');
      }
    } catch {
      throw new Error('WEB_ORIGIN must be an HTTP(S) origin without a path.');
    }
  }
  const solanaRpcUrl = config.SOLANA_RPC_URL;
  if (solanaRpcUrl !== undefined) {
    if (typeof solanaRpcUrl !== 'string') {
      throw new Error('SOLANA_RPC_URL must be an HTTPS endpoint.');
    }
    try {
      const endpoint = new URL(solanaRpcUrl);
      const localHttpEndpoint = config.NODE_ENV !== 'production' &&
        endpoint.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
      if (
        (!localHttpEndpoint && endpoint.protocol !== 'https:') ||
        !endpoint.hostname ||
        endpoint.username ||
        endpoint.password ||
        endpoint.hash
      ) {
        throw new Error('SOLANA_RPC_URL must be an HTTPS endpoint.');
      }
    } catch {
      throw new Error('SOLANA_RPC_URL must be an HTTPS endpoint.');
    }
  }
  const supportedEvmChainIds = new Set(['1', '10', '56', '137', '8453', '42161', '43114']);
  for (const [key, value] of Object.entries(config)) {
    if (key.startsWith('EVM_RPC_URL_') && value !== undefined && value !== '') {
      const chainId = key.slice('EVM_RPC_URL_'.length);
      if (!supportedEvmChainIds.has(chainId) || typeof value !== 'string') {
        throw new Error(`${key} must configure a supported EVM chain endpoint.`);
      }
      try {
        const endpoint = new URL(value);
        const localHttpEndpoint = config.NODE_ENV !== 'production' &&
          endpoint.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
        if (
          (!localHttpEndpoint && endpoint.protocol !== 'https:') ||
          !endpoint.hostname ||
          endpoint.username ||
          endpoint.password ||
          endpoint.hash
        ) {
          throw new Error(`${key} must be an HTTPS endpoint.`);
        }
      } catch {
        throw new Error(`${key} must be an HTTPS endpoint.`);
      }
    }
    if (key.startsWith('EVM_CONFIRMATIONS_') && value !== undefined && value !== '') {
      const chainId = key.slice('EVM_CONFIRMATIONS_'.length);
      const confirmations = typeof value === 'string' ? Number(value) : value;
      if (
        !supportedEvmChainIds.has(chainId) ||
        (typeof value === 'string' && !/^\d{1,4}$/.test(value)) ||
        !Number.isInteger(confirmations) ||
        Number(confirmations) < 2 ||
        Number(confirmations) > 1000
      ) {
        throw new Error(`${key} must be an integer between 2 and 1000.`);
      }
    }
  }
  return config;
}
