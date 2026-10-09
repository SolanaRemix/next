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
        redis.hash
      ) {
        throw new Error('REDIS_URL must use redis:// or rediss://.');
      }
    } catch {
      throw new Error('REDIS_URL must use redis:// or rediss:// and include a hostname.');
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
  return config;
}
