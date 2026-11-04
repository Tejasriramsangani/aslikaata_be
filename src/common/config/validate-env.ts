/**
 * Boot-time check for the single `.env` file. The app takes every secret and connection string from
 * there only (no built-in fallbacks), so a missing value stops startup with a clear message instead of
 * silently running with a public default key or a different database.
 */
const REQUIRED = [
  ['MONGODB_URI', 'MongoDB connection string'],
  ['JWT_ACCESS_SECRET', 'secret used to sign access tokens'],
  ['ENCRYPTION_MASTER_KEY', '64 hex characters (32 bytes) used to encrypt KYC identifiers'],
] as const;

export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const missing = REQUIRED.filter(([key]) => !String(config[key] ?? '').trim());
  if (missing.length) {
    throw new Error(
      `Missing required settings in aslikaata_be/.env:\n${missing
        .map(([key, why]) => `  - ${key}  (${why})`)
        .join('\n')}`,
    );
  }
  const key = String(config.ENCRYPTION_MASTER_KEY).trim();
  if (!/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error('ENCRYPTION_MASTER_KEY in .env must be exactly 64 hex characters (32 bytes).');
  }
  return config;
}
