import { z } from 'zod';
import { FileStoreConfig } from './file-store-config';

// Every environment variable the API reads, validated once at startup.
// A missing or malformed variable stops the server immediately with a clear message,
// instead of failing later on the first request that needs it.
const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  // true behind a load balancer / Caddy, so request.ip is the client's IP, not the proxy's
  TRUST_PROXY: z.stringbool().default(false),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  OTP_HASH_SECRET: z.string().min(32, 'must be at least 32 characters'),
  JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
  SMS_PROVIDER: z.enum(['console', 'msg91']).default('console'),
  OTP_DAILY_BUDGET: z.coerce.number().int().positive().default(2000),
  REVIEW_LOGIN_PHONE: z.string().optional(),
  REVIEW_LOGIN_OTP: z
    .string()
    .regex(/^\d{6}$/, 'must be 6 digits')
    .optional(),
  // Request limits per minute (KB #46). Generous: they stop scripts and runaway loops, not people.
  API_RATE_LIMIT_PER_IP: z.coerce.number().int().positive().default(600),
  API_RATE_LIMIT_PER_USER: z.coerce.number().int().positive().default(300),
  // Error tracking (Step 40). Unset: errors are only logged. APP_RELEASE: the deployed
  // version (e.g. the git commit), so Sentry shows which code an error came from.
  SENTRY_DSN: z.url().optional(),
  APP_RELEASE: z.string().max(100).optional(),
  ...FileStoreConfig,
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: Record<string, string | undefined>): Config {
  // Treat `KEY=` (empty) the same as not set.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  const result = ConfigSchema.safeParse(cleaned);
  if (!result.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(result.error)}`);
  }
  const config = result.data;
  if ((config.REVIEW_LOGIN_PHONE === undefined) !== (config.REVIEW_LOGIN_OTP === undefined)) {
    throw new Error(
      'Invalid configuration: set both REVIEW_LOGIN_PHONE and REVIEW_LOGIN_OTP, or neither',
    );
  }
  return config;
}
