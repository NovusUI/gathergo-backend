import * as Joi from 'joi';
import type { RedisOptions } from 'ioredis';

const DEFAULT_PORT = 3000;
const DEFAULT_REDIS_HOST = '127.0.0.1';
const DEFAULT_REDIS_PORT = 6379;
const DEFAULT_REDIS_DB = 0;
const DEFAULT_JWT_SECRET = 'local-dev-jwt-secret-change-me';
const DEFAULT_JWT_REFRESH_SECRET =
  'local-dev-jwt-refresh-secret-change-me';
const DEFAULT_JWT_EXPIRES_IN = '15m';
const DEFAULT_JWT_REFRESH_EXPIRES_IN = '7d';

const privateNetworkOriginPattern =
  /^https?:\/\/(?:(?:localhost|127\.0\.0\.1)|(?:10(?:\.\d{1,3}){3})|(?:192\.168(?:\.\d{1,3}){2})|(?:172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2}))(?::\d+)?$/;

function normalizeEnvValue(value?: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getRequiredEnv(name: string, fallback?: string): string {
  const value = normalizeEnvValue(process.env[name]);
  if (value) {
    return value;
  }

  if (isProduction()) {
    throw new Error(`${name} is required in production`);
  }

  if (fallback) {
    return fallback;
  }

  throw new Error(`${name} is required`);
}

function parseList(value?: string | null): string[] {
  return (value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseRedisUrl(redisUrl: string): RedisOptions {
  const parsed = new URL(redisUrl);
  const databaseName = parsed.pathname.replace('/', '');
  const db =
    databaseName.length > 0
      ? parseNumber(databaseName, DEFAULT_REDIS_DB)
      : DEFAULT_REDIS_DB;

  const options: RedisOptions = {
    host: parsed.hostname,
    port: parsed.port
      ? parseNumber(parsed.port, DEFAULT_REDIS_PORT)
      : DEFAULT_REDIS_PORT,
    db,
  };

  const username = normalizeEnvValue(decodeURIComponent(parsed.username));
  if (username) {
    options.username = username;
  }

  const password = normalizeEnvValue(decodeURIComponent(parsed.password));
  if (password) {
    options.password = password;
  }

  if (parsed.protocol === 'rediss:') {
    options.tls = {};
  }

  return options;
}

export function getNodeEnv(): string {
  return normalizeEnvValue(process.env.NODE_ENV) || 'development';
}

export function isProduction(): boolean {
  return getNodeEnv() === 'production';
}

export function getPort(): number {
  return parseNumber(process.env.PORT, DEFAULT_PORT);
}

export function getJwtSecret(): string {
  return getRequiredEnv('JWT_SECRET', DEFAULT_JWT_SECRET);
}

export function getJwtRefreshSecret(): string {
  const refreshSecret = normalizeEnvValue(process.env.JWT_REFRESH_SECRET);
  if (refreshSecret) {
    return refreshSecret;
  }

  if (isProduction()) {
    return getRequiredEnv('JWT_REFRESH_SECRET');
  }

  return normalizeEnvValue(process.env.JWT_SECRET)
    ? getJwtSecret()
    : DEFAULT_JWT_REFRESH_SECRET;
}

export function getJwtExpiresIn(): string {
  return normalizeEnvValue(process.env.JWT_EXPIRES_IN) || DEFAULT_JWT_EXPIRES_IN;
}

export function getJwtRefreshExpiresIn(): string {
  return (
    normalizeEnvValue(process.env.JWT_REFRESH_EXPIRES_IN) ||
    DEFAULT_JWT_REFRESH_EXPIRES_IN
  );
}

export function getGoogleCallbackUrl(): string {
  const explicitCallbackUrl = normalizeEnvValue(process.env.GOOGLE_CALLBACK_URL);
  if (explicitCallbackUrl) {
    return explicitCallbackUrl;
  }

  const renderHostname = normalizeEnvValue(process.env.RENDER_EXTERNAL_HOSTNAME);
  if (renderHostname) {
    return `https://${renderHostname}/api/v1/auth/google/redirect`;
  }

  return `http://localhost:${getPort()}/api/v1/auth/google/redirect`;
}

export function getAllowedCorsOrigins(): string[] {
  return Array.from(
    new Set([
      ...parseList(process.env.CORS_ALLOWED_ORIGINS),
      ...parseList(process.env.FRONTEND_URL),
    ]),
  );
}

export function isCorsOriginAllowed(origin?: string): boolean {
  if (!origin) {
    return true;
  }

  const allowedOrigins = getAllowedCorsOrigins();
  if (allowedOrigins.length === 0) {
    return !isProduction() || privateNetworkOriginPattern.test(origin);
  }

  if (allowedOrigins.includes(origin)) {
    return true;
  }

  return !isProduction() && privateNetworkOriginPattern.test(origin);
}

export function createCorsOriginValidator() {
  return (
    origin: string | undefined,
    callback: (error: Error | null, allow?: boolean) => void,
  ) => {
    if (isCorsOriginAllowed(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`Origin ${origin} is not allowed by CORS`));
  };
}

export function getRedisOptions(
  overrides: Partial<RedisOptions> = {},
): RedisOptions {
  const redisUrl = normalizeEnvValue(process.env.REDIS_URL);

  const baseOptions = redisUrl
    ? parseRedisUrl(redisUrl)
    : {
        host: normalizeEnvValue(process.env.REDIS_HOST) || DEFAULT_REDIS_HOST,
        port: parseNumber(process.env.REDIS_PORT, DEFAULT_REDIS_PORT),
        db: parseNumber(process.env.REDIS_DB, DEFAULT_REDIS_DB),
        username: normalizeEnvValue(process.env.REDIS_USERNAME),
        password: normalizeEnvValue(process.env.REDIS_PASSWORD),
        tls:
          normalizeEnvValue(process.env.REDIS_TLS_ENABLED) === 'true'
            ? {}
            : undefined,
      };

  return {
    ...baseOptions,
    ...overrides,
  };
}

export function validateEnvironment(config: Record<string, unknown>) {
  const schema = Joi.object({
    NODE_ENV: Joi.string()
      .valid('development', 'test', 'production')
      .default('development'),
    PORT: Joi.number().port().default(DEFAULT_PORT),
    DATABASE_URL: Joi.string().required(),
    SHADOW_DATABASE_URL: Joi.string().allow('').optional(),
    FRONTEND_URL: Joi.string().allow('').optional(),
    CORS_ALLOWED_ORIGINS: Joi.string().allow('').optional(),
    JWT_SECRET: Joi.string()
      .min(16)
      .when('NODE_ENV', { is: 'production', then: Joi.required() }),
    JWT_REFRESH_SECRET: Joi.string()
      .min(16)
      .when('NODE_ENV', { is: 'production', then: Joi.required() }),
    JWT_EXPIRES_IN: Joi.string().default(DEFAULT_JWT_EXPIRES_IN),
    JWT_REFRESH_EXPIRES_IN: Joi.string().default(
      DEFAULT_JWT_REFRESH_EXPIRES_IN,
    ),
    REDIS_URL: Joi.string()
      .uri({ scheme: ['redis', 'rediss'] })
      .allow('')
      .optional(),
    REDIS_HOST: Joi.string().allow('').optional(),
    REDIS_PORT: Joi.number().port().default(DEFAULT_REDIS_PORT),
    REDIS_USERNAME: Joi.string().allow('').optional(),
    REDIS_PASSWORD: Joi.string().allow('').optional(),
    REDIS_DB: Joi.number().integer().min(0).default(DEFAULT_REDIS_DB),
    REDIS_TLS_ENABLED: Joi.string().valid('true', 'false').default('false'),
    GOOGLE_CALLBACK_URL: Joi.string()
      .uri({ scheme: [/https?/] })
      .allow('')
      .optional(),
  });

  const { error, value } = schema.validate(config, {
    abortEarly: false,
    allowUnknown: true,
    convert: true,
  });

  if (error) {
    throw new Error(`Environment validation error: ${error.message}`);
  }

  if (value.NODE_ENV !== 'production') {
    value.JWT_SECRET = value.JWT_SECRET || DEFAULT_JWT_SECRET;
    value.JWT_REFRESH_SECRET = value.JWT_REFRESH_SECRET || value.JWT_SECRET;
  }

  for (const [key, envValue] of Object.entries(value)) {
    if (envValue === undefined || envValue === null) {
      continue;
    }

    process.env[key] = String(envValue);
  }

  return value;
}
